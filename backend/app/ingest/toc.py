"""Derive a chapter list (TOC) from a book's detected heading blocks.

Font-size alone can't separate a book's *title* (a unique, oversized one-off)
from its *chapter headings* (a recurring, consistently-styled tier). We use two
signals, in order:

1. **Pattern** — headings that announce a division ("Capítulo II", "Chapter One",
   "Prólogo", a roman numeral or bare number). Titles/bylines never match these,
   so they're excluded for free, and a heading split across a page break only
   matches on its keyword fragment.
2. **Size frequency** — when no keywords are present (named chapters), cluster
   heading font sizes: the title is the largest size occurring only once or
   twice (discard it); the recurring large size is the chapter tier.
"""

from __future__ import annotations

import re
from collections import Counter
from statistics import median

from app.models import Block, BlockType, TocEntry

# A heading that names a structural division. Anchored at the start of the line.
CHAPTER_RE = re.compile(
    r"^\s*(?:"
    # keyworded divisions (ES / EN / a few others)
    r"(?:cap[ií]tulo|cap\.|chapter|chapitre|kapitel|capitolo|canto|"
    r"parte|part|libro|book|tomo|secci[oó]n|section|acto|act|escena|scene)\b"
    # front / back matter
    r"|(?:pr[oó]logo|prologue|ep[ií]logo|epilogue|introducci[oó]n|introduction|"
    r"prefacio|preface|ap[eé]ndice|appendix|conclusi[oó]n|conclusion)\b"
    # a bare roman numeral or number used as a chapter marker
    r"|[IVXLCDM]{1,7}\.?\s*$"
    r"|\d{1,3}\.?\s*$"
    r")",
    re.IGNORECASE,
)


# A heading that is just a chapter number (bare roman numeral or integer).
_BARE_RE = re.compile(r"^(?:[IVXLCDM]{1,7}|\d{1,3})\.?$", re.IGNORECASE)


def _label(block: Block, headings: list[Block]) -> str:
    """A readable chapter label. If the heading is a bare number/numeral, fold
    in the next descriptive heading on the same page (e.g. '1' + 'El niño que
    vivió' -> '1. El niño que vivió')."""
    text = block.text.strip()
    if not _BARE_RE.match(text):
        return text
    for h in headings:
        if h.page == block.page and h.order > block.order:
            sib = h.text.strip()
            if sib and not _BARE_RE.match(sib):
                return f"{text.rstrip('.')}. {sib}"
    return text


def _by_size(headings: list[Block], body_size: float) -> list[Block]:
    sized = [b for b in headings if b.size]
    if not sized:
        return []  # no font info to cluster — return nothing rather than junk
    big = [b for b in sized if b.size and b.size >= body_size * 1.1] or sized
    freq = Counter(round(b.size) for b in big if b.size)
    sizes = sorted(freq, reverse=True)
    # The title is the largest size if it barely occurs (<= 2 times).
    title_size = sizes[0] if (len(sizes) >= 2 and freq[sizes[0]] <= 2) else None
    candidates = [s for s in sizes if s != title_size]
    # Prefer the largest *recurring* size; otherwise the largest remaining.
    chapter_size = next((s for s in candidates if freq[s] >= 2), None)
    if chapter_size is None and candidates:
        chapter_size = candidates[0]
    return [b for b in big if b.size and round(b.size) == chapter_size]


def derive_toc(blocks: list[Block], body_size: float | None = None) -> list[TocEntry]:
    headings = [b for b in blocks if b.type == BlockType.heading and b.text.strip()]
    if not headings:
        return []

    matched = [b for b in headings if CHAPTER_RE.match(b.text.strip())]
    if len(matched) >= 2:
        chosen = matched
    else:
        if body_size is None:
            sizes = [b.size for b in blocks if b.type == BlockType.paragraph and b.size]
            body_size = median(sizes) if sizes else 12.0
        chosen = _by_size(headings, body_size)

    chosen = sorted(chosen, key=lambda b: (b.page, b.order))
    toc: list[TocEntry] = []
    for b in chosen:
        title = _label(b, headings)
        if toc and toc[-1].title == title:
            continue  # collapse immediate duplicates
        toc.append(TocEntry(level=1, title=title, page=b.page))
    return toc
