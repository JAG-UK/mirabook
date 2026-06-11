"""Re-ingest every stored book from its saved source PDF, in place.

Block ids are deterministic (p{page}-b{order}), so cached translations remain
valid. Use this after ingest/TOC logic changes to refresh existing books
without re-uploading.

Run:  uv run python scripts/reingest.py
"""

from pathlib import Path

from app.config import get_settings
from app.ingest.pdf import ingest_pdf
from app.store.db import Store


def main() -> None:
    s = get_settings()
    data = Path(s.data_dir)
    store = Store(data / "mirabook.db")
    try:
        for meta in store.list_books():
            media = data / "media" / meta.id
            pdf = media / "source.pdf"
            if not pdf.exists():
                print(f"skip {meta.id} ({meta.title}) — no source.pdf")
                continue
            m, blocks = ingest_pdf(
                pdf, meta.id, meta.title, media, f"/media/{meta.id}",
                meta.source_lang, meta.target_lang,
            )
            store.save_book(m, blocks)
            print(f"reingested {m.title!r}: {m.page_count} pages, {len(m.toc)} chapters")
    finally:
        store.close()


if __name__ == "__main__":
    main()
