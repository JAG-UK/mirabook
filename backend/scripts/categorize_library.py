"""File unshelved books onto a themed shelf.

Books imported from Project Gutenberg are shelved on the way in, from Project
Gutenberg's own cataloguing. Anything uploaded by hand — or imported before
shelves existed — arrives unshelved, and this puts it away:

    cd backend
    uv run python scripts/categorize_library.py --dry-run   # see the proposals
    uv run python scripts/categorize_library.py             # apply them

The shelf list is fixed (see `app.shelves`), so the model chooses from a closed
set rather than inventing categories — fourteen shelves a reader can browse,
not two hundred near-duplicates.

    --all        re-shelve every book, not just the unshelved ones
    --dry-run    print proposals without touching the library
    --model M    Ollama model to ask (default: configured)
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import httpx

from app.config import get_settings
from app.models import BookMeta
from app.shelves import SHELVES, normalize_shelf
from app.store.db import Store
from app.translate.ollama import OllamaProvider

SYSTEM = (
    "You are a librarian filing a book onto one of a fixed set of shelves. "
    "Choose the single best shelf for the book from this list, and no other:\n"
    + "\n".join(f"- {s}" for s in SHELVES)
    + '\n\nReply as JSON: {"shelf": "<exactly one shelf name from the list>"}'
)


def opening_lines(store: Store, book: BookMeta, chars: int = 500) -> str:
    """A little of the book's own prose.

    A title is thin evidence — "La Cría de Cabras" reads as folklore and is in
    fact a husbandry manual. Two or three sentences of the text settle it.
    """
    out: list[str] = []
    for page in range(1, min(book.page_count, 6) + 1):
        for block in store.get_page(book.id, page):
            if block.text.strip():
                out.append(" ".join(block.text.split()))
                if sum(len(t) for t in out) >= chars:
                    return " ".join(out)[:chars]
    return " ".join(out)[:chars]


async def choose_shelf(provider: OllamaProvider, book: BookMeta, sample: str = "") -> str | None:
    user = f"Title: {book.title}"
    if book.author:
        user += f"\nAuthor: {book.author}"
    if book.toc:
        chapters = "; ".join(t.title for t in book.toc[:8])
        user += f"\nChapters: {chapters[:400]}"
    if sample:
        user += f"\nOpening lines: {sample}"
    try:
        data = json.loads(await provider._chat(SYSTEM, user, as_json=True))
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    except httpx.HTTPStatusError as e:
        detail = " ".join(e.response.text.split())[:120]
        print(f"      HTTP {e.response.status_code}: {detail}")
        return None
    except httpx.HTTPError:
        # A timeout or a dropped connection must cost one book, not the run.
        return None
    # The model is asked for a closed set, but never trust it to honour that.
    return normalize_shelf(data.get("shelf"))


async def main_async(args) -> None:
    settings = get_settings()
    store = Store(Path(settings.data_dir) / "mirabook.db")
    try:
        books = store.list_books()
        todo = books if args.all else [b for b in books if not b.shelf]
        if not todo:
            print(f"Every one of the {len(books)} books is already shelved.")
            return

        provider = OllamaProvider(
            settings.ollama_host, args.model or settings.ollama_model, 1, settings.ollama_timeout
        )
        await provider.ensure_ready()
        print(f"Shelving {len(todo)} book(s) with {provider.model_id}…\n")

        shelved = failed = 0
        for i, book in enumerate(todo, 1):
            shelf = await choose_shelf(provider, book, opening_lines(store, book))
            if shelf is None:
                print(f"  [{i}/{len(todo)}] ??  {book.title[:52]:54} (no usable answer)")
                failed += 1
                continue
            was = f" (was {book.shelf})" if book.shelf and book.shelf != shelf else ""
            print(f"  [{i}/{len(todo)}] ->  {book.title[:52]:54} {shelf}{was}")
            if not args.dry_run:
                store.set_shelf(book.id, shelf)
            shelved += 1

        if args.dry_run:
            print(f"\n--dry-run: nothing changed. {shelved} would be shelved, {failed} unresolved.")
        else:
            print(f"\nShelved {shelved}, left {failed} unshelved.")
            counts = store.shelf_counts()
            for name in SHELVES:
                if counts.get(name):
                    print(f"  {counts[name]:>4}  {name}")
            if counts.get(""):
                print(f"  {counts['']:>4}  (unshelved)")
    finally:
        store.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--all", action="store_true", help="re-shelve every book")
    p.add_argument("--dry-run", action="store_true", help="print proposals, change nothing")
    p.add_argument("--model", help="Ollama model to ask (default: configured)")
    try:
        asyncio.run(main_async(p.parse_args()))
    except RuntimeError as e:
        raise SystemExit(f"\n{e}") from None
    except KeyboardInterrupt:
        raise SystemExit("\nInterrupted.") from None


if __name__ == "__main__":
    main()
