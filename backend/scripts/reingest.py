"""Re-ingest every stored book from its saved source file (PDF or EPUB), in place.

Block ids are deterministic (p{page}-b{order}), so cached translations remain
valid. Use this after ingest/TOC logic changes to refresh existing books
without re-uploading.

Run:  uv run python scripts/reingest.py
"""

from pathlib import Path

from app.config import get_settings
from app.ingest.gutenberg import page_count, strip_boilerplate
from app.ingest.pdf import ingest_document
from app.store.db import Store


def main() -> None:
    s = get_settings()
    data = Path(s.data_dir)
    store = Store(data / "mirabook.db")
    try:
        for meta in store.list_books():
            media = data / "media" / meta.id
            src = next(iter(media.glob("source.*")), None)
            if src is None:
                print(f"skip {meta.id} ({meta.title}) — no source file")
                continue
            m, blocks = ingest_document(
                src, meta.id, meta.title, media, f"/media/{meta.id}",
                meta.source_lang, meta.target_lang,
            )
            # Gutenberg books were imported with their licence boilerplate
            # trimmed; re-ingest has to trim it the same way or every block id
            # shifts and the cached translations are orphaned.
            if (meta.source or "").startswith("gutenberg:"):
                blocks = strip_boilerplate(blocks)
                m.page_count = page_count(blocks)
                m.toc = [t for t in m.toc if t.page <= m.page_count]
            m.author, m.shelf, m.source = meta.author, meta.shelf, meta.source
            store.save_book(m, blocks)
            print(f"reingested {m.title!r}: {m.page_count} pages, {len(m.toc)} chapters")
    finally:
        store.close()


if __name__ == "__main__":
    main()
