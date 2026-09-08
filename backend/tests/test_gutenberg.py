"""Tests for Gutenberg boilerplate stripping and the themed-shelf taxonomy."""

import pytest

from app.ingest.gutenberg import page_count, renumber, strip_boilerplate
from app.models import Block, BlockType
from app.shelves import SHELVES, pg_categories, shelf_for, shelf_from_locc


def blocks_from(texts: list[str], per_page: int = 4) -> list[Block]:
    return [
        Block(
            id=f"p{i // per_page + 1}-b{i}",
            page=i // per_page + 1,
            order=i,
            type=BlockType.paragraph,
            text=t,
        )
        for i, t in enumerate(texts)
    ]


def body_text(blocks: list[Block]) -> list[str]:
    return [b.text for b in blocks]


# Enough filler that the 20% edge windows behave as they do on a real book.
BODY = [f"Capítulo {i}. En un lugar de la Mancha." for i in range(200)]


# --- modern boilerplate ---


def test_strips_modern_start_and_end_markers():
    raw = blocks_from(
        ["The Project Gutenberg eBook of Don Quijote", "Release date: 1999"]
        + ["*** START OF THE PROJECT GUTENBERG EBOOK DON QUIJOTE ***"]
        + BODY
        + ["*** END OF THE PROJECT GUTENBERG EBOOK DON QUIJOTE ***", "Licence text follows."]
    )
    assert body_text(strip_boilerplate(raw)) == BODY


def test_accepts_the_etext_spelling():
    raw = blocks_from(
        ["*** START OF THIS PROJECT GUTENBERG ETEXT LA CELESTINA ***"]
        + BODY
        + ["*** END OF THIS PROJECT GUTENBERG ETEXT LA CELESTINA ***"]
    )
    assert body_text(strip_boilerplate(raw)) == BODY


# --- legacy 1990s "SMALL PRINT!" boilerplate ---


def test_strips_legacy_small_print_boilerplate():
    """PG #1619 (La Celestina) opens like this — no modern START marker at all,
    and the header is repeated after the small print block."""
    raw = blocks_from(
        [
            "**This is a COPYRIGHTED Project Gutenberg Etext, Details Below**",
            "The Project Gutenberg Etext of La Celestina, by Fernando de Rojas",
            "*******This file should be named 1619.txt or 1619.zip******",
            "***START** SMALL PRINT! for COPYRIGHT PROTECTED ETEXTS ***",
            "[B] EXACT AND MODIFIED COPIES: the copies you distribute must…",
            "*SMALL PRINT! Ver.04.29.93 FOR COPYRIGHT PROTECTED ETEXTS*END*",
        ]
        + BODY
        + ["Project Gutenberg Literary Archive Foundation", "www.gutenberg.net"]
    )
    assert body_text(strip_boilerplate(raw)) == BODY


# --- safety rails ---


def test_untouched_when_no_markers_are_present():
    raw = blocks_from(BODY)
    assert body_text(strip_boilerplate(raw)) == BODY


def test_a_mention_deep_in_the_text_cannot_truncate_the_book():
    """Only the outer fifth is boilerplate territory, so a marker phrase in the
    middle of a long work is left alone."""
    middle = len(BODY) // 2
    marker = "…as transcribed for www.gutenberg.org by a volunteer…"
    texts = BODY[:middle] + [marker] + BODY[middle:]
    raw = blocks_from(texts)
    assert len(strip_boilerplate(raw)) == len(texts)


def test_everything_is_kept_rather_than_nothing_when_markers_overlap():
    raw = blocks_from(["*** START OF THE PROJECT GUTENBERG EBOOK X ***"] * 4)
    assert len(strip_boilerplate(raw)) == 4


def test_empty_input():
    assert strip_boilerplate([]) == []


# --- renumbering ---


def test_renumber_reopens_the_book_on_page_one():
    raw = blocks_from(BODY, per_page=3)[7:]
    out = renumber(raw)
    assert out[0].page == 1
    assert out[0].id == "p1-b0"
    assert [b.id for b in out] == [f"p{b.page}-b{i}" for i, b in enumerate(out)]
    assert len({b.id for b in out}) == len(out)


def test_renumber_collapses_pages_that_lost_every_block():
    raw = [
        Block(id="x", page=5, order=0, type=BlockType.paragraph, text="a"),
        Block(id="y", page=9, order=1, type=BlockType.paragraph, text="b"),
    ]
    assert [b.page for b in renumber(raw)] == [1, 2]


def test_page_count_of_stripped_body():
    assert page_count(renumber(blocks_from(BODY, per_page=10))) == 20
    assert page_count([]) == 0


# --- shelves ---


def test_pg_category_tags_are_extracted():
    field = "6 Best Loved Spanish Literary Classics; Category: Novels; Category: Poetry"
    assert pg_categories(field) == ["Novels", "Poetry"]


@pytest.mark.parametrize(
    "bookshelves,expected",
    [
        ("Category: Novels", "Novels"),
        ("Category: Poetry", "Poetry"),
        ("Category: Plays/Films/Dramas", "Theatre"),
        ("Category: History - European", "History"),
        ("Category: Children & Young Adult Reading", "For Younger Readers"),
    ],
)
def test_shelf_from_pg_category(bookshelves, expected):
    assert shelf_for(bookshelves, "") == expected


def test_the_most_specific_shelf_wins():
    """PG tags a great many things "Novels" alongside something more useful."""
    assert shelf_for("Category: Novels; Category: Poetry", "") == "Poetry"
    assert shelf_for("Category: Novels; Category: Children & Young Adult Reading", "") == (
        "For Younger Readers"
    )
    assert shelf_for("Category: Novels; Category: Historical Novels", "") == "Novels"


def test_locc_is_the_fallback_when_there_is_no_category():
    assert shelf_for("", "PQ") == "Novels"
    assert shelf_for("", "DP") == "History"
    assert shelf_for("", "B") == "Philosophy & Religion"
    # Two-letter codes beat the one-letter prefix.
    assert shelf_from_locc("BS") == "Philosophy & Religion"


def test_pg_categories_beat_locc():
    assert shelf_for("Category: Poetry", "DP") == "Poetry"


def test_unknown_signals_yield_no_shelf():
    assert shelf_for("", "") is None
    assert shelf_for("Category: Nonsense", "") is None


@pytest.mark.parametrize(
    "proposed,expected",
    [
        ("Novels", "Novels"),
        ("novels", "Novels"),
        ("  Poetry  ", "Poetry"),
        ("POETRY.", "Poetry"),
        ("Myth & Folklore", "Myth & Folklore"),
    ],
)
def test_normalize_shelf_accepts_real_shelves_however_they_are_written(proposed, expected):
    from app.shelves import normalize_shelf

    assert normalize_shelf(proposed) == expected


@pytest.mark.parametrize("proposed", ["Fiction", "Category: Novels", "", None, "Novels and Poetry"])
def test_normalize_shelf_rejects_anything_invented(proposed):
    """A model that ignores the closed set must not create a shelf of one."""
    from app.shelves import normalize_shelf

    assert normalize_shelf(proposed) is None


def test_every_mapped_shelf_is_a_real_shelf():
    """A typo in the mapping would create a shelf the library never displays."""
    from app.shelves import _LOCC_TO_SHELF, _PG_CATEGORY_TO_SHELF, SHELF_PRIORITY

    for shelf in {*_PG_CATEGORY_TO_SHELF.values(), *_LOCC_TO_SHELF.values(), *SHELF_PRIORITY}:
        assert shelf in SHELVES, f"{shelf!r} is not in SHELVES"
    assert set(SHELF_PRIORITY) == set(SHELVES)
