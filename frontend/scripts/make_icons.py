"""Generate Mirabook PWA icons (an open book on a dark field).

Run from the backend venv (PyMuPDF):
  cd backend && uv run python ../frontend/scripts/make_icons.py
Outputs frontend/public/icon-192.png and icon-512.png.
"""

from pathlib import Path

import fitz

OUT = Path(__file__).resolve().parents[1] / "public"
BG = (0.110, 0.098, 0.090)  # stone-900-ish
PAPER = (0.972, 0.956, 0.917)  # warm ivory
SPINE = (0.62, 0.55, 0.42)
LINE = (0.78, 0.74, 0.66)


def make_icon(size: int, out: Path) -> None:
    doc = fitz.open()
    page = doc.new_page(width=size, height=size)

    bg = page.new_shape()
    bg.draw_rect(fitz.Rect(0, 0, size, size))
    bg.finish(fill=BG, color=None)
    bg.commit()

    s = page.new_shape()
    mx = size * 0.17
    top, bot = size * 0.27, size * 0.75
    cx = size / 2
    # two facing pages
    s.draw_rect(fitz.Rect(mx, top, cx, bot))
    s.draw_rect(fitz.Rect(cx, top, size - mx, bot))
    s.finish(fill=PAPER, color=None)
    s.commit()

    # spine + a few text lines per page
    d = page.new_shape()
    d.draw_line(fitz.Point(cx, top), fitz.Point(cx, bot))
    d.finish(color=SPINE, width=size * 0.014)
    for i in range(4):
        y = top + (bot - top) * (0.22 + i * 0.19)
        d.draw_line(fitz.Point(mx + size * 0.05, y), fitz.Point(cx - size * 0.05, y))
        d.draw_line(fitz.Point(cx + size * 0.05, y), fitz.Point(size - mx - size * 0.05, y))
    d.finish(color=LINE, width=size * 0.012)
    d.commit()

    page.get_pixmap(alpha=False).save(out)
    print(f"wrote {out}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_icon(512, OUT / "icon-512.png")
    make_icon(192, OUT / "icon-192.png")
    make_icon(180, OUT / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
