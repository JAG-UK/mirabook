"""Trim Project Gutenberg's licence boilerplate out of an ingested book.

Every PG ebook wraps the work in a header and a licence footer. Left in, that is
dozens of blocks of English legalese that Mirabook would faithfully translate
and show to the reader as if it were the book.

There are two eras of boilerplate and a book may use either:

* **Modern** — delimited by the familiar lines
  ``*** START OF THE PROJECT GUTENBERG EBOOK <title> ***`` and its END twin.
* **Legacy** (texts released in the 1990s) — a "SMALL PRINT!" copyright notice
  with its own ``***START**``/``*END*`` markers, usually followed by a repeat of
  the header. `La Celestina`, PG #1619, is one of these.

Rather than encode both grammars, this finds every block that looks like PG
apparatus and cuts to the last one near the front and the first one near the
back. Marker phrases are specific enough not to fire on the work itself, and
only the outer fifth of the book is examined, so a passing mention in the text
cannot truncate it.

Stripping is deterministic given the same file, so block ids stay stable and
cached translations survive a re-ingest — provided every path that ingests a PG
book applies it. `scripts/reingest.py` does so for anything whose provenance
starts with "gutenberg:".
"""

from __future__ import annotations

import re

from app.models import Block

# Phrases that only ever appear in Project Gutenberg's own apparatus.
_MARKERS = re.compile(
    r"\*\*\*\s*(START|END) OF (THE|THIS) PROJECT GUTENBERG"
    r"|SMALL PRINT!"
    r"|COPYRIGHTED PROJECT GUTENBERG"
    r"|THE PROJECT GUTENBERG (ETEXT|EBOOK) OF"
    r"|THIS FILE SHOULD BE NAMED"
    r"|PROJECT GUTENBERG LITERARY ARCHIVE FOUNDATION"
    r"|PROJECT GUTENBERG.{0,30}(LICENSE|TRADEMARK|EBOOKS? IS|ELECTRONIC WORKS)"
    r"|WWW\.GUTENBERG\.(ORG|NET)"
    r"|PGLAF"
    r"|START OF THE PROJECT GUTENBERG",
    re.IGNORECASE,
)

# Only the outer fifth of a book is considered boilerplate territory.
_EDGE_FRACTION = 0.2
_MIN_EDGE_BLOCKS = 40


def _edge(total: int) -> int:
    return max(_MIN_EDGE_BLOCKS, int(total * _EDGE_FRACTION))


def strip_boilerplate(blocks: list[Block]) -> list[Block]:
    """Return the work itself, renumbered so it opens on page 1.

    Blocks are returned unchanged when no marker is found — a hand-made or
    already-trimmed file is left alone rather than guessed at.
    """
    if not blocks:
        return blocks
    total = len(blocks)
    edge = min(_edge(total), total)

    marked = [i for i, b in enumerate(blocks) if _MARKERS.search(b.text)]
    if not marked:
        return blocks

    head = [i for i in marked if i < edge]
    tail = [i for i in marked if i >= total - edge]
    start = head[-1] + 1 if head else 0
    end = tail[0] if tail else total

    if start >= end:  # pathological; better to keep everything than nothing
        return blocks
    return renumber(blocks[start:end])


def renumber(blocks: list[Block]) -> list[Block]:
    """Rebuild page numbers and ids so the first surviving page becomes page 1.

    Pages that lost every block collapse, so a reader never lands on a blank
    page that used to hold the licence.
    """
    if not blocks:
        return []
    pages = sorted({b.page for b in blocks})
    remap = {old: new for new, old in enumerate(pages, start=1)}

    out: list[Block] = []
    for order, b in enumerate(blocks):
        page = remap[b.page]
        out.append(b.model_copy(update={"id": f"p{page}-b{order}", "page": page, "order": order}))
    return out


def page_count(blocks: list[Block]) -> int:
    return max((b.page for b in blocks), default=0)
