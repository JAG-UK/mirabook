"""Tests for the SQLite store: block round-trips, the per-model translation
cache, re-ingest semantics, and the additive column migration."""

import sqlite3

import pytest

from app.models import Block, BlockType, BookMeta, TocEntry, TranslatedBlock
from app.store.db import Store

MODEL = "ollama:test#p1"
OTHER_MODEL = "ollama:other#p1"


def make_meta(book_id: str = "bk1", **kw) -> BookMeta:
    return BookMeta(
        **{
            "id": book_id,
            "title": "Don Quijote",
            "source_lang": "Spanish",
            "target_lang": "English",
            "page_count": 2,
            "toc": [TocEntry(title="Capítulo I", page=1, level=1)],
            **kw,
        }
    )


def make_blocks() -> list[Block]:
    return [
        Block(
            id="p1-b0",
            page=1,
            order=0,
            type=BlockType.heading,
            text="Capítulo I",
            level=1,
            size=20.0,
            bbox=(1.0, 2.0, 3.0, 4.0),
        ),
        Block(
            id="p1-b1", page=1, order=1, type=BlockType.paragraph, text="En un lugar…", size=11.0
        ),
        Block(id="p1-b2", page=1, order=2, type=BlockType.image, src="/media/bk1/images/a.png"),
        Block(
            id="p2-b3", page=2, order=3, type=BlockType.paragraph,
            text="…de la Mancha.", size=11.0,
        ),
    ]


@pytest.fixture
def store(tmp_path) -> Store:
    s = Store(tmp_path / "test.db")
    yield s
    s.close()


@pytest.fixture
def loaded(store: Store) -> Store:
    store.save_book(make_meta(), make_blocks())
    return store


# --- books ---


def test_save_and_get_book_round_trip(loaded: Store):
    got = loaded.get_book("bk1")
    assert got is not None
    assert got.title == "Don Quijote"
    assert got.page_count == 2
    assert [t.title for t in got.toc] == ["Capítulo I"]


def test_get_book_returns_none_when_missing(store: Store):
    assert store.get_book("nope") is None


def test_list_books(loaded: Store):
    loaded.save_book(make_meta("bk2", title="Otro"), [])
    assert {b.id for b in loaded.list_books()} == {"bk1", "bk2"}


# --- blocks ---


def test_get_page_returns_only_that_page_in_reading_order(loaded: Store):
    page1 = loaded.get_page("bk1", 1)
    assert [b.id for b in page1] == ["p1-b0", "p1-b1", "p1-b2"]
    assert [b.id for b in loaded.get_page("bk1", 2)] == ["p2-b3"]


def test_block_fields_survive_the_round_trip(loaded: Store):
    heading, paragraph, image = loaded.get_page("bk1", 1)
    assert heading.type is BlockType.heading
    assert heading.level == 1
    assert heading.size == 20.0
    assert heading.bbox == (1.0, 2.0, 3.0, 4.0)
    assert paragraph.bbox is None
    assert image.type is BlockType.image
    assert image.src == "/media/bk1/images/a.png"


def test_get_headings_skips_body_and_empty_text(loaded: Store):
    assert [b.id for b in loaded.get_headings("bk1")] == ["p1-b0"]


def test_body_size_is_the_paragraph_median(loaded: Store):
    assert loaded.body_size("bk1") == 11.0


def test_body_size_defaults_when_no_sized_paragraphs(store: Store):
    store.save_book(make_meta("bare"), [])
    assert store.body_size("bare") == 12.0


def test_resaving_a_book_replaces_its_blocks(loaded: Store):
    """Re-ingest must not accumulate stale blocks alongside the new ones."""
    loaded.save_book(
        make_meta(),
        [Block(id="p1-b0", page=1, order=0, type=BlockType.paragraph, text="Nuevo")],
    )
    page1 = loaded.get_page("bk1", 1)
    assert [b.id for b in page1] == ["p1-b0"]
    assert page1[0].text == "Nuevo"


# --- translation cache ---


def test_translation_cache_round_trip(loaded: Store):
    loaded.save_translations(
        "bk1",
        MODEL,
        [TranslatedBlock(id="p1-b1", text="In a place…", alternatives=["Somewhere…"])],
    )
    cached = loaded.get_cached("bk1", ["p1-b1"], MODEL)
    assert cached["p1-b1"].text == "In a place…"
    assert cached["p1-b1"].alternatives == ["Somewhere…"]


def test_get_cached_with_no_ids_does_not_query(loaded: Store):
    assert loaded.get_cached("bk1", [], MODEL) == {}


def test_get_cached_omits_blocks_that_were_never_translated(loaded: Store):
    loaded.save_translations("bk1", MODEL, [TranslatedBlock(id="p1-b1", text="In a place…")])
    cached = loaded.get_cached("bk1", ["p1-b1", "p2-b3"], MODEL)
    assert set(cached) == {"p1-b1"}


def test_cache_is_keyed_per_model(loaded: Store):
    """Switching model (or bumping PROMPT_VERSION) must re-translate."""
    loaded.save_translations("bk1", MODEL, [TranslatedBlock(id="p1-b1", text="In a place…")])
    assert loaded.get_cached("bk1", ["p1-b1"], OTHER_MODEL) == {}


def test_cache_is_keyed_per_book(loaded: Store):
    loaded.save_book(make_meta("bk2"), make_blocks())
    loaded.save_translations("bk1", MODEL, [TranslatedBlock(id="p1-b1", text="In a place…")])
    assert loaded.get_cached("bk2", ["p1-b1"], MODEL) == {}


def test_saving_a_translation_twice_overwrites(loaded: Store):
    loaded.save_translations("bk1", MODEL, [TranslatedBlock(id="p1-b1", text="first")])
    loaded.save_translations("bk1", MODEL, [TranslatedBlock(id="p1-b1", text="second")])
    assert loaded.get_cached("bk1", ["p1-b1"], MODEL)["p1-b1"].text == "second"


# --- deletion ---


def test_delete_book_removes_rows_blocks_and_translations(loaded: Store):
    loaded.save_translations("bk1", MODEL, [TranslatedBlock(id="p1-b1", text="In a place…")])
    loaded.save_book(make_meta("bk2"), make_blocks())

    loaded.delete_book("bk1")

    assert loaded.get_book("bk1") is None
    assert loaded.get_page("bk1", 1) == []
    assert loaded.get_cached("bk1", ["p1-b1"], MODEL) == {}
    # ...and leaves other books alone.
    assert loaded.get_book("bk2") is not None
    assert len(loaded.get_page("bk2", 1)) == 3


# --- migration ---


def test_opening_a_pre_size_database_adds_the_column(tmp_path):
    """Databases created before `size` existed must upgrade in place."""
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE blocks (
          book_id TEXT NOT NULL, block_id TEXT NOT NULL, page INTEGER NOT NULL,
          ord INTEGER NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
          level INTEGER, src TEXT, bbox_json TEXT,
          PRIMARY KEY (book_id, block_id)
        );
        INSERT INTO blocks (book_id, block_id, page, ord, type, text)
        VALUES ('bk1', 'p1-b0', 1, 0, 'paragraph', 'En un lugar…');
        """
    )
    conn.commit()
    conn.close()

    store = Store(path)
    try:
        block = store.get_page("bk1", 1)[0]
        assert block.text == "En un lugar…"
        assert block.size is None
    finally:
        store.close()
