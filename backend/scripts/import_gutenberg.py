"""Bulk-import Spanish books from Project Gutenberg into the shared library.

Run this on the machine that serves Mirabook:

    cd backend
    uv run python scripts/import_gutenberg.py --limit 20      # try it out
    uv run python scripts/import_gutenberg.py                 # the whole lot

What it does, in order:

1. Downloads Project Gutenberg's machine-readable catalogue (the approved bulk
   feed — 79k rows) and keeps a local copy.
2. Narrows it to Spanish-language texts: 885 of them, at the time of writing.
3. Judges each one for cultural value with the local Ollama model, since the
   Spanish collection holds plenty of ephemera alongside the classics. Verdicts
   are cached on disk, so re-runs cost nothing and can be reviewed or edited by
   hand.
4. Downloads the EPUB for each keeper from a Project Gutenberg *mirror*,
   politely — gutenberg.org itself blocks automated access and asks bulk users
   to use a mirror with a delay between requests.
5. Ingests it, trims PG's licence boilerplate, and files it on a themed shelf
   derived from Project Gutenberg's own cataloguing.

It is safe to interrupt and re-run: books already imported are skipped by
provenance, and cached verdicts are not re-asked.

Useful flags:
    --limit N          stop after importing N books
    --dry-run          assess and report, download nothing
    --assess-only      just build the verdict cache, import nothing
    --shelf NAME       only import books that land on one shelf
    --delay SECONDS    politeness delay between downloads (default 2)
    --mirror URL       a different Project Gutenberg mirror
    --model NAME       Ollama model for the assessment (default: configured)
    --keep-all         skip the cultural-value judgement, take everything
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import get_settings
from app.ingest.gutenberg import page_count, strip_boilerplate
from app.ingest.pdf import ingest_document
from app.models import BookMeta
from app.shelves import shelf_for
from app.store.db import Store
from app.translate.ollama import OllamaProvider

CATALOG_URL = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv"
DEFAULT_MIRROR = "https://gutenberg.pglaf.org"
USER_AGENT = "Mirabook/0.1 (personal library import; +https://github.com/JAG-UK/mirabook)"

# EPUB paths a mirror may carry, best first.
EPUB_PATHS = (
    "cache/epub/{id}/pg{id}-images-3.epub",
    "cache/epub/{id}/pg{id}-3.epub",
    "cache/epub/{id}/pg{id}.epub",
)

# PG's own curated shelves. Membership is a strong enough signal of standing
# that these skip the model entirely.
CURATED = (
    "Harvard Classics",
    "Best Books Ever Listings",
    "Nobel Prizes in Literature",
    "6 Best Loved Spanish Literary Classics",
)

ASSESS_SYSTEM = (
    "You are a librarian selecting Spanish-language books for a language "
    "learner's reading collection. Judge each book on cultural value: literary "
    "merit, historical or intellectual significance, or standing as a work "
    "worth reading. Keep novels, poetry, drama, essays, memoirs, folklore, "
    "history and philosophy of real substance. Reject ephemera: narrow "
    "technical or agricultural manuals, trade catalogues, local directories, "
    "government and committee reports, promotional pamphlets, and fragments or "
    "single issues of periodicals. Be selective but not precious — a solid "
    "regional novel or a well-written travel memoir is worth keeping.\n"
    'Reply as JSON: {"keep": true or false, "reason": "at most 12 words"}'
)


@dataclass
class Candidate:
    pg_id: str
    title: str
    author: str
    subjects: str
    locc: str
    bookshelves: str

    @property
    def source(self) -> str:
        return f"gutenberg:{self.pg_id}"

    @property
    def shelf(self) -> str | None:
        return shelf_for(self.bookshelves, self.locc)

    @property
    def curated(self) -> bool:
        return any(c in self.bookshelves for c in CURATED)

    def prompt(self) -> str:
        parts = [f"Title: {self.title}", f"Author: {self.author or 'unknown'}"]
        if self.subjects:
            parts.append(f"Subjects: {self.subjects}")
        if self.bookshelves:
            parts.append(f"Gutenberg shelves: {self.bookshelves}")
        return "\n".join(parts)


# --- catalogue -------------------------------------------------------------


def load_catalog(path: Path, refresh: bool) -> list[Candidate]:
    if refresh or not path.is_file():
        print(f"Downloading the Gutenberg catalogue -> {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        with httpx.stream(
            "GET", CATALOG_URL, timeout=180, follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as r:
            r.raise_for_status()
            with path.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        print(f"  {path.stat().st_size / 1e6:.1f} MB")

    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [
        Candidate(
            pg_id=r["Text#"].strip(),
            title=" ".join(r["Title"].split()),
            author=" ".join(r["Authors"].split()),
            subjects=r["Subjects"].strip(),
            locc=r["LoCC"].strip(),
            bookshelves=r["Bookshelves"].strip(),
        )
        for r in rows
        if r["Language"] == "es" and r["Type"] == "Text"
    ]


# --- cultural-value assessment --------------------------------------------


def load_verdicts(path: Path) -> dict[str, dict]:
    if path.is_file():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            print(f"warning: {path} is not valid JSON; starting a fresh cache")
    return {}


def save_verdicts(path: Path, verdicts: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(verdicts, indent=1, ensure_ascii=False, sort_keys=True))


async def verdict_for(
    c: Candidate, verdicts: dict[str, dict], provider: OllamaProvider | None
) -> dict:
    """This book's verdict, asking the model only if it is not already cached.

    A failed assessment is returned but never cached, so a model hiccup cannot
    silently blacklist a book for every future run.
    """
    if c.pg_id in verdicts:
        return verdicts[c.pg_id]
    if provider is None:
        return {"keep": True, "reason": "assessment skipped"}
    if c.curated:
        result = {"keep": True, "reason": "on a curated Gutenberg shelf"}
    else:
        result = await _ask(provider, c)
    if not result.get("error"):
        verdicts[c.pg_id] = result
    return result


async def assess_all(
    candidates: list[Candidate], verdicts: dict[str, dict], provider: OllamaProvider, path: Path
) -> None:
    """Judge every candidate up front — for --dry-run and --assess-only, where
    the whole picture is the point."""
    todo = [c for c in candidates if c.pg_id not in verdicts]
    if not todo:
        return
    print(f"Assessing {len(todo)} book(s) with {provider.model_id}…")
    for i, c in enumerate(todo, 1):
        v = await verdict_for(c, verdicts, provider)
        mark = "keep" if v["keep"] else "skip"
        print(f"  [{i}/{len(todo)}] {mark}  {c.title[:56]:58} {v['reason'][:40]}")
        if i % 20 == 0:
            save_verdicts(path, verdicts)  # checkpoint a long run
    save_verdicts(path, verdicts)


async def _ask(provider: OllamaProvider, c: Candidate) -> dict:
    try:
        raw = await provider._chat(ASSESS_SYSTEM, c.prompt(), as_json=True)
        data = json.loads(raw)
        return {
            "keep": bool(data.get("keep")),
            "reason": str(data.get("reason", ""))[:120] or "no reason given",
        }
    except (json.JSONDecodeError, TypeError, ValueError, httpx.HTTPError) as e:
        # Never silently drop a book because the model misbehaved.
        return {"keep": False, "reason": f"assessment failed: {type(e).__name__}", "error": True}


# --- download + ingest -----------------------------------------------------


def download_epub(client: httpx.Client, mirror: str, pg_id: str, dest: Path) -> bool:
    for template in EPUB_PATHS:
        url = f"{mirror.rstrip('/')}/{template.format(id=pg_id)}"
        try:
            r = client.get(url)
        except httpx.HTTPError:
            continue
        if r.status_code == 200 and r.content[:2] == b"PK":  # a zip, i.e. an epub
            dest.write_bytes(r.content)
            return True
    return False


def looks_spanish(text: str) -> bool:
    """Cheap sanity check that the text really is Spanish.

    The catalogue's language tag is reliable, but a mislabelled entry would
    otherwise sit in the library untranslatable. Counting function words beats
    asking a model: it is instant, free and deterministic.
    """
    words = re.findall(r"[a-záéíóúñü]+", text.lower())
    if len(words) < 60:
        return True  # too little to judge; let it through
    spanish = {"de", "la", "que", "el", "en", "y", "los", "se", "del", "las", "un", "por", "con"}
    english = {"the", "of", "and", "to", "in", "that", "is", "was", "it", "for"}
    hits = sum(w in spanish for w in words)
    misses = sum(w in english for w in words)
    return hits > misses


def import_book(
    c: Candidate, epub: Path, media_dir: Path, book_id: str, settings
) -> tuple[BookMeta, list] | None:
    meta, blocks = ingest_document(
        epub, book_id, c.title, media_dir,
        media_url=f"/media/{book_id}",
        source_lang=settings.source_lang,
        target_lang=settings.target_lang,
    )
    body = strip_boilerplate(blocks)
    if not body:
        return None
    sample = " ".join(b.text for b in body[:80])
    if not looks_spanish(sample):
        return None
    meta.page_count = page_count(body)
    meta.author = c.author or None
    meta.shelf = c.shelf
    meta.source = c.source
    meta.toc = [t for t in meta.toc if t.page <= meta.page_count]
    return meta, body


# --- main ------------------------------------------------------------------


async def main_async(args) -> None:
    settings = get_settings()
    data = Path(settings.data_dir)
    catalog_path = data / "pg_catalog.csv"
    verdict_path = data / "gutenberg-verdicts.json"

    candidates = load_catalog(catalog_path, args.refresh_catalog)
    print(f"{len(candidates)} Spanish texts in the catalogue")

    store = Store(data / "mirabook.db")
    try:
        already = store.sources()
        candidates = [c for c in candidates if c.source not in already]
        print(f"{len(already)} already imported; {len(candidates)} to consider")
        if args.shelf:
            candidates = [c for c in candidates if c.shelf == args.shelf]
            print(f"{len(candidates)} on the {args.shelf!r} shelf")
        if not candidates:
            return

        verdicts = load_verdicts(verdict_path)
        provider = None
        if not args.keep_all:
            provider = OllamaProvider(
                settings.ollama_host,
                args.model or settings.ollama_model,
                1,
                settings.ollama_timeout,
            )

        # --dry-run and --assess-only want the whole picture, so judge
        # everything. A normal run judges lazily as it goes, so `--limit 20`
        # costs about twenty assessments rather than nine hundred.
        if (args.dry_run or args.assess_only) and provider is not None:
            await assess_all(candidates, verdicts, provider, verdict_path)
            keepers = [c for c in candidates if verdicts.get(c.pg_id, {}).get("keep")]
            print(f"\n{len(keepers)} of {len(candidates)} judged worth keeping")
            by_shelf: dict[str, int] = {}
            for c in keepers:
                by_shelf[c.shelf or "Unshelved"] = by_shelf.get(c.shelf or "Unshelved", 0) + 1
            print("Shelves: " + ", ".join(f"{k} {v}" for k, v in sorted(by_shelf.items())))
            if args.assess_only:
                print(f"Verdicts written to {verdict_path}")
                return
            print("\n--dry-run: nothing downloaded. First 15 keepers:")
            for c in keepers[:15]:
                print(f"  {c.pg_id:>6}  {(c.shelf or '-'):20} {c.title[:60]}")
            return
        if args.dry_run or args.assess_only:
            print("--keep-all with --dry-run: every candidate would be imported.")
            return

        imported = skipped = rejected = 0
        headers = {"User-Agent": USER_AGENT}
        with httpx.Client(timeout=120, follow_redirects=True, headers=headers) as client:
            for c in candidates:
                if args.limit and imported >= args.limit:
                    break
                v = await verdict_for(c, verdicts, provider)
                if not v["keep"]:
                    rejected += 1
                    if rejected % 25 == 0:
                        save_verdicts(verdict_path, verdicts)
                    continue

                book_id = uuid.uuid4().hex[:12]
                media_dir = data / "media" / book_id
                media_dir.mkdir(parents=True, exist_ok=True)
                epub = media_dir / "source.epub"

                if not download_epub(client, args.mirror, c.pg_id, epub):
                    print(f"  no epub    {c.pg_id:>6}  {c.title[:56]}")
                    _cleanup(media_dir)
                    skipped += 1
                    continue

                try:
                    result = import_book(c, epub, media_dir, book_id, settings)
                except Exception as e:  # a single bad file must not stop the run
                    print(f"  failed     {c.pg_id:>6}  {c.title[:44]}  ({type(e).__name__}: {e})")
                    _cleanup(media_dir)
                    skipped += 1
                    continue

                if result is None:
                    print(f"  not usable {c.pg_id:>6}  {c.title[:56]}")
                    _cleanup(media_dir)
                    skipped += 1
                    continue

                meta, blocks = result
                store.save_book(meta, blocks)
                imported += 1
                print(
                    f"  [{imported}] {meta.title[:44]:46} {meta.page_count:>4}pp  "
                    f"{(meta.shelf or '-'):20} {c.author[:26]}"
                )
                save_verdicts(verdict_path, verdicts)
                time.sleep(args.delay)  # be a good citizen of the mirror

        save_verdicts(verdict_path, verdicts)
        print(
            f"\nImported {imported}, rejected {rejected}, skipped {skipped}. "
            f"Library now holds {len(store.list_books())} books."
        )
    finally:
        store.close()


def _cleanup(media_dir: Path) -> None:
    import shutil

    shutil.rmtree(media_dir, ignore_errors=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--limit", type=int, help="stop after importing this many books")
    p.add_argument("--dry-run", action="store_true", help="assess and report, download nothing")
    p.add_argument("--assess-only", action="store_true", help="build the verdict cache and stop")
    p.add_argument("--shelf", help="only import books landing on this shelf")
    p.add_argument("--delay", type=float, default=2.0, help="seconds between downloads (default 2)")
    p.add_argument("--mirror", default=DEFAULT_MIRROR, help=f"PG mirror (default {DEFAULT_MIRROR})")
    p.add_argument("--model", help="Ollama model for assessment (default: configured)")
    p.add_argument("--keep-all", action="store_true", help="skip the cultural-value judgement")
    p.add_argument("--refresh-catalog", action="store_true", help="re-download the catalogue")
    args = p.parse_args()
    if args.delay < 2 and not args.dry_run:
        print("warning: Gutenberg asks for >=2s between requests; --delay below that risks a block")
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        sys.exit("\nInterrupted — re-run to carry on where this left off.")


if __name__ == "__main__":
    main()
