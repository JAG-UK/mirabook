"""PDF ingestion: PyMuPDF -> normalized, selectable Document/Block model.

Strategy: extract per-page text spans and images, preserve reading order by
(y, x), and classify headings by comparing a text run's max font size to the
document's median (body) size. Images are written to the book's media dir and
referenced by a URL path so the frontend can render them inline at position.
"""

from __future__ import annotations

import statistics
from pathlib import Path

import fitz  # PyMuPDF

from app.models import Block, BlockType, BookMeta, TocEntry

# Heading thresholds, as a ratio over the document's median body font size.
_H1_RATIO = 1.5
_H2_RATIO = 1.28
_H3_RATIO = 1.12
_BOLD_FLAG = 1 << 4  # PyMuPDF span flag bit for bold


def _spans_of(text_block: dict) -> list[dict]:
    return [span for line in text_block.get("lines", []) for span in line.get("spans", [])]


def _median_body_size(doc: fitz.Document) -> float:
    sizes: list[float] = []
    for page in doc:
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for span in _spans_of(b):
                if span.get("text", "").strip():
                    sizes.append(round(span["size"], 1))
    return statistics.median(sizes) if sizes else 12.0


def _classify(max_size: float, body: float, bold: bool, text: str) -> tuple[BlockType, int | None]:
    ratio = max_size / body if body else 1.0
    if ratio >= _H1_RATIO:
        return BlockType.heading, 1
    if ratio >= _H2_RATIO:
        return BlockType.heading, 2
    if ratio >= _H3_RATIO or (bold and len(text) < 80):
        return BlockType.heading, 3
    return BlockType.paragraph, None


def ingest_pdf(
    pdf_path: Path,
    book_id: str,
    title: str,
    media_dir: Path,
    media_url: str,
    source_lang: str,
    target_lang: str,
) -> tuple[BookMeta, list[Block]]:
    doc = fitz.open(pdf_path)
    images_dir = media_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    body = _median_body_size(doc)
    blocks: list[Block] = []
    order = 0
    img_n = 0

    for pno, page in enumerate(doc, start=1):
        raw = page.get_text("dict")["blocks"]
        # Reading order: top-to-bottom, then left-to-right.
        raw.sort(key=lambda b: (round(b["bbox"][1]), round(b["bbox"][0])))
        for b in raw:
            bbox = tuple(round(v, 1) for v in b["bbox"])
            if b.get("type") == 1:  # image
                img_n += 1
                ext = b.get("ext", "png")
                name = f"img-{pno}-{img_n}.{ext}"
                (images_dir / name).write_bytes(b["image"])
                blocks.append(
                    Block(
                        id=f"p{pno}-b{order}",
                        page=pno,
                        order=order,
                        type=BlockType.image,
                        src=f"{media_url}/images/{name}",
                        bbox=bbox,
                    )
                )
                order += 1
                continue

            spans = _spans_of(b)
            text = " ".join(s["text"] for s in spans).strip()
            if not text:
                continue
            max_size = max((s["size"] for s in spans), default=body)
            bold = any(int(s.get("flags", 0)) & _BOLD_FLAG for s in spans)
            btype, level = _classify(max_size, body, bold, text)
            blocks.append(
                Block(
                    id=f"p{pno}-b{order}",
                    page=pno,
                    order=order,
                    type=btype,
                    text=text,
                    level=level,
                    bbox=bbox,
                )
            )
            order += 1

    toc = [
        TocEntry(level=lvl, title=t.strip(), page=pg)
        for lvl, t, pg in doc.get_toc()
    ]
    meta = BookMeta(
        id=book_id,
        title=title,
        source_lang=source_lang,
        target_lang=target_lang,
        page_count=doc.page_count,
        toc=toc,
    )
    doc.close()
    return meta, blocks
