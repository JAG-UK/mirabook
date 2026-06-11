"""Build a small, text-based Spanish sample PDF for development.

Source: Don Quijote (Miguel de Cervantes), Project Gutenberg #2000 — public
domain. We take the first few chapters, render chapter titles as headings and
the prose as paragraphs (so heading classification has something to detect), and
embed one generated figure (so image extraction has something to find).

Run:  uv run python sample-books/build_sample.py
Output: sample-books/don-quijote-es.pdf
"""

from __future__ import annotations

import html
import re
import urllib.request
from pathlib import Path

import fitz  # PyMuPDF

HERE = Path(__file__).parent
TXT_URL = "https://gutenberg.org/cache/epub/2000/pg2000.txt"
TXT_CACHE = Path("/tmp/pg2000.txt")
OUT = HERE / "don-quijote-es.pdf"
N_CHAPTERS = 4


def load_text() -> str:
    if TXT_CACHE.exists():
        return TXT_CACHE.read_text(encoding="utf-8")
    data = urllib.request.urlopen(TXT_URL, timeout=60).read().decode("utf-8")
    TXT_CACHE.write_text(data, encoding="utf-8")
    return data


def extract_chapters(text: str) -> list[tuple[str, list[str]]]:
    """Return [(chapter_title, [paragraphs])] for the first N chapters."""
    lines = text.splitlines()
    starts = [i for i, ln in enumerate(lines) if re.match(r"^Capítulo ", ln)]
    starts = starts[: N_CHAPTERS + 1]
    chapters: list[tuple[str, list[str]]] = []
    for idx in range(min(N_CHAPTERS, len(starts) - 1)):
        a, b = starts[idx], starts[idx + 1]
        title = lines[a].strip()
        body = "\n".join(lines[a + 1 : b]).strip()
        paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", body)]
        paras = [p for p in paras if p]
        chapters.append((title, paras))
    return chapters


def make_figure() -> bytes:
    """A simple embedded raster so the ingest image path is exercised."""
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 480, 300))
    pix.set_rect(pix.irect, (214, 232, 224))  # pale green field
    pix.set_rect(fitz.IRect(40, 40, 440, 120), (120, 160, 140))  # darker band
    return pix.tobytes("png")


def build_html(chapters: list[tuple[str, list[str]]]) -> str:
    parts = [
        "<h1>Don Quijote de la Mancha</h1>",
        "<p class='byline'>Miguel de Cervantes Saavedra</p>",
        "<img src='fig1.png' width='360' height='225'/>",
        "<p class='caption'>Figura 1. Lámina de muestra.</p>",
    ]
    for title, paras in chapters:
        parts.append(f"<h2>{html.escape(title)}</h2>")
        parts.extend(f"<p>{html.escape(p)}</p>" for p in paras)
    body = "\n".join(parts)
    css = """
      h1 { font-size: 26px; font-weight: bold; margin-bottom: 4px; }
      h2 { font-size: 18px; font-weight: bold; margin-top: 18px; }
      p  { font-size: 11px; line-height: 1.5; text-align: justify; }
      .byline { font-size: 13px; font-style: italic; }
      .caption { font-size: 9px; font-style: italic; }
    """
    return f"<html><head><style>{css}</style></head><body>{body}</body></html>"


def main() -> None:
    chapters = extract_chapters(load_text())
    arch = fitz.Archive()
    arch.add(make_figure(), "fig1.png")
    story = fitz.Story(html=build_html(chapters), archive=arch)

    writer = fitz.DocumentWriter(OUT)
    mediabox = fitz.paper_rect("a5")
    where = mediabox + (40, 40, -40, -50)
    more = 1
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()

    doc = fitz.open(OUT)
    print(f"Wrote {OUT} — {doc.page_count} pages, {len(chapters)} chapters")
    doc.close()


if __name__ == "__main__":
    main()
