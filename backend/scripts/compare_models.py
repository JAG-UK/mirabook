"""Compare Ollama models on real book text, using Mirabook's own prompts.

Answers the question "which model should MIRABOOK_OLLAMA_MODEL point at on this
machine?" by running the same blocks through each candidate and reporting both
speed and output, so you can judge quality yourself.

    # on the GPU box, with Ollama already running
    cd backend
    uv run python scripts/compare_models.py gemma2:27b gemma4:26b gemma4:31b

It calls the provider directly, so nothing is written to the database and the
translation cache is left untouched.

Useful flags:
    --book ID        use a book from the library instead of the sample PDF
    --page N         which page to take blocks from (default 1)
    --blocks N       how many text blocks to translate (default 4)
    --no-aids        skip the grammar/alternatives checks
    --out report.md  also write the results as Markdown

Notes on fair timing: each model is warmed up before the clock starts, because
the first request loads it into VRAM. Models are compared one at a time, and
Ollama evicts the previous one, so run this when the box is otherwise idle.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import tempfile
import time
from pathlib import Path

import httpx

from app.config import get_settings
from app.ingest.pdf import ingest_document
from app.models import Block, BlockType
from app.store.db import Store
from app.translate.ollama import OllamaProvider

SAMPLE = Path(__file__).resolve().parents[2] / "sample-books" / "don-quijote-es.pdf"

# A phrase with enough going on to tell a capable model from a translator-only
# one: a reflexive, an idiom, and a subjunctive.
AID_PHRASE = "no se ande con rodeos"
AID_CONTEXT = "Le rogué que no se ande con rodeos y me dijera la verdad."


class Timed:
    def __init__(self) -> None:
        self.seconds: float = 0.0

    async def __aenter__(self) -> Timed:
        self._start = time.perf_counter()
        return self

    async def __aexit__(self, *exc) -> None:
        self.seconds = time.perf_counter() - self._start


def installed_models(host: str) -> dict[str, float]:
    """{name: size_in_GB} for everything Ollama has pulled locally."""
    try:
        r = httpx.get(f"{host.rstrip('/')}/api/tags", timeout=10)
        r.raise_for_status()
    except Exception as e:
        sys.exit(f"Cannot reach Ollama at {host}: {e}\nStart it first (ollama serve).")
    return {m["name"]: m.get("size", 0) / 1e9 for m in r.json().get("models", [])}


def resolve(model: str, available: dict[str, float]) -> str | None:
    """Ollama reports 'gemma4:31b'; accept a bare 'gemma4' as ':latest' too."""
    if model in available:
        return model
    if ":" not in model and f"{model}:latest" in available:
        return f"{model}:latest"
    return None


def source_blocks(book_id: str | None, page: int, limit: int) -> tuple[str, list[Block]]:
    """Text blocks to translate, from the library or from the sample PDF."""
    settings = get_settings()
    if book_id:
        store = Store(Path(settings.data_dir) / "mirabook.db")
        try:
            meta = store.get_book(book_id)
            if not meta:
                titles = ", ".join(f"{b.id} ({b.title})" for b in store.list_books())
                sys.exit(f"No book {book_id!r}. Available: {titles or '(none)'}")
            blocks = store.get_page(book_id, page)
            label = f"{meta.title}, page {page}"
        finally:
            store.close()
    else:
        if not SAMPLE.is_file():
            sys.exit(f"Sample book not found at {SAMPLE}")
        with tempfile.TemporaryDirectory() as tmp:
            _, blocks = ingest_document(
                SAMPLE, "compare", "sample", Path(tmp), "/media/compare", "Spanish", "English"
            )
        blocks = [b for b in blocks if b.page == page]
        label = f"sample Don Quijote, page {page}"

    usable = [b for b in blocks if b.type != BlockType.image and len(b.text.strip()) > 40]
    if not usable:
        sys.exit(f"No substantial text blocks on page {page} of {label}. Try another --page.")
    return label, usable[:limit]


async def run_model(model: str, blocks: list[Block], aids: bool, settings) -> dict:
    """Translate every block sequentially, timing each one."""
    provider = OllamaProvider(settings.ollama_host, model, 1, settings.ollama_timeout)
    src, tgt = settings.source_lang, settings.target_lang

    print(f"\n  {model}: loading into memory…", end="", flush=True)
    async with Timed() as warm:
        await provider._translate_text("Hola.", src, tgt)
    print(f" {warm.seconds:.1f}s")

    outputs, times = [], []
    for i, b in enumerate(blocks, 1):
        async with Timed() as t:
            text = await provider._translate_text(b.text, src, tgt)
        outputs.append(text.strip())
        times.append(t.seconds)
        print(f"    block {i}/{len(blocks)}  {t.seconds:6.2f}s  ({len(b.text)} chars)")

    result = {
        "model": model,
        "load": warm.seconds,
        "times": times,
        "outputs": outputs,
        "chars": sum(len(b.text) for b in blocks),
    }

    if aids:
        async with Timed() as t:
            explanation = await provider.explain(AID_PHRASE, AID_CONTEXT, "idiom", src, tgt)
        result["idiom"] = (explanation.text.strip(), t.seconds)
        print(f"    idiom explanation  {t.seconds:6.2f}s")

        async with Timed() as t:
            alts = await provider.alternatives(AID_PHRASE, AID_CONTEXT, src, tgt)
        result["alternatives"] = ([a.text for a in alts], t.seconds)
        print(f"    alternatives       {t.seconds:6.2f}s  ({len(alts)} options)")

    return result


def report(results: list[dict], blocks: list[Block], label: str, page_count: int) -> str:
    """Human-readable summary; returned as a string so it can also be saved."""
    out: list[str] = []
    w = out.append

    w(f"# Model comparison — {label}\n")
    w(f"{len(blocks)} blocks, {sum(len(b.text) for b in blocks)} characters of source text.\n")

    w("## Speed\n")
    w("| Model | Load | Mean/block | Median | Total | Est. whole book |")
    w("| --- | --- | --- | --- | --- | --- |")
    for r in results:
        mean = statistics.mean(r["times"])
        blocks_per_page = len(blocks)
        est = mean * blocks_per_page * page_count / 60
        w(
            f"| `{r['model']}` | {r['load']:.1f}s | {mean:.2f}s | "
            f"{statistics.median(r['times']):.2f}s | {sum(r['times']):.1f}s | ~{est:.0f} min |"
        )
    w(
        "\nWhole-book estimate assumes this page is typical and translation is "
        "sequential; raise MIRABOOK_OLLAMA_CONCURRENCY (and the server's "
        "OLLAMA_NUM_PARALLEL) to cut it roughly proportionally.\n"
    )

    w("## Translations\n")
    for i, b in enumerate(blocks):
        w(f"### Block {i + 1}\n")
        w(f"**Source ({b.type.value}):** {b.text}\n")
        for r in results:
            w(f"**{r['model']}:** {r['outputs'][i]}\n")

    if any("idiom" in r for r in results):
        w("## Reading aids\n")
        w(f"Phrase: *{AID_PHRASE}* — in: *{AID_CONTEXT}*\n")
        w(
            "The GPU model has to handle these as well as prose. Translation "
            "specialists can do fine here, so judge the output rather than "
            "assuming — but watch the latency: these run while the reader "
            "waits, with no cache behind them.\n"
        )
        for r in results:
            if "idiom" not in r:
                continue
            w(f"### {r['model']}\n")
            w(f"**Idiom ({r['idiom'][1]:.1f}s):** {r['idiom'][0]}\n")
            options = "; ".join(r["alternatives"][0])
            w(f"**Alternatives ({r['alternatives'][1]:.1f}s):** {options}\n")

    return "\n".join(out)


async def main_async(args) -> None:
    settings = get_settings()
    available = installed_models(settings.ollama_host)

    resolved, missing = [], []
    for m in args.models:
        hit = resolve(m, available)
        (resolved.append(hit) if hit else missing.append(m))
    if missing:
        print(f"Not pulled on this machine: {', '.join(missing)}")
        for m in missing:
            print(f"  ollama pull {m}")
        if not resolved:
            sys.exit(1)
        print()

    label, blocks = source_blocks(args.book, args.page, args.blocks)
    page_count = args.page_count
    print(f"Comparing {len(resolved)} model(s) on {label} — {len(blocks)} blocks")
    print(f"Ollama: {settings.ollama_host}   {settings.source_lang} -> {settings.target_lang}")

    results = []
    for model in resolved:
        results.append(await run_model(model, blocks, not args.no_aids, settings))

    text = report(results, blocks, label, page_count)
    print("\n" + "=" * 70 + "\n")
    print(text)
    if args.out:
        Path(args.out).write_text(text)
        print(f"\nWritten to {args.out}")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compare Ollama models on real book text using Mirabook's prompts."
    )
    p.add_argument("models", nargs="+", help="Ollama model tags, e.g. gemma4:31b")
    p.add_argument("--book", help="book id from the library (default: the sample PDF)")
    p.add_argument("--page", type=int, default=1, help="page to take blocks from (default 1)")
    p.add_argument("--blocks", type=int, default=4, help="blocks to translate (default 4)")
    p.add_argument(
        "--page-count", type=int, default=200, help="book length for the estimate (default 200)"
    )
    p.add_argument("--no-aids", action="store_true", help="skip grammar/alternatives checks")
    p.add_argument("--out", help="also write the report to this Markdown file")
    asyncio.run(main_async(p.parse_args()))


if __name__ == "__main__":
    main()
