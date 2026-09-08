from enum import Enum

from pydantic import BaseModel


class BlockType(str, Enum):
    heading = "heading"
    paragraph = "paragraph"
    list = "list"
    image = "image"


class Block(BaseModel):
    """One unit of a page: a heading, paragraph, list item, or image.

    The block `id` is stable per book and is the alignment key shared between a
    source block and its translation (powers blur + highlight matching).
    """

    id: str
    page: int
    order: int
    type: BlockType
    text: str = ""
    level: int | None = None  # heading level (1 = biggest)
    size: float | None = None  # dominant font size (pt), used for TOC detection
    src: str | None = None  # URL path for image blocks
    bbox: tuple[float, float, float, float] | None = None


class TranslatedBlock(BaseModel):
    id: str
    text: str
    alternatives: list[str] = []


class Page(BaseModel):
    number: int
    blocks: list[Block]
    translations: list[TranslatedBlock] = []


class TocEntry(BaseModel):
    title: str
    page: int
    level: int = 1


class BookMeta(BaseModel):
    id: str
    title: str
    source_lang: str
    target_lang: str
    page_count: int
    toc: list[TocEntry] = []
    author: str | None = None
    shelf: str | None = None  # themed shelf, see app.shelves
    source: str | None = None  # provenance, e.g. "gutenberg:2000" — keeps
    # re-imports idempotent and records where a book came from


class Explanation(BaseModel):
    kind: str  # grammar | idiom
    text: str
    gloss: str | None = None  # a few words; the answer side of a review card


# --- reader-owned records -------------------------------------------------
#
# Everything below belongs to a reader rather than to the library, and syncs
# between their devices. Ids are generated on the client so a record can be
# created offline and keep its identity when it reaches the server.
#
# Every record carries the timestamp its own conflict rule turns on, and a
# `deleted_at` tombstone: without one, a delete made offline is
# indistinguishable from a record this device has not seen yet, and deleted
# things come back to life on the next sync.


class Reader(BaseModel):
    """A person using this Mirabook, not an account. There is one password for
    the whole app; readers are the "who's reading?" picker, stored centrally so
    a phone and a tablet show the same people."""

    id: str
    name: str
    avatar: str
    settings_json: str = "{}"  # opaque to the backend; the UI owns its shape
    updated_at: str
    deleted_at: str | None = None


class ReadingProgress(BaseModel):
    book_id: str
    page: int
    updated_at: str


class Favourite(BaseModel):
    book_id: str
    created_at: str
    deleted_at: str | None = None


class SavedWord(BaseModel):
    id: str
    text: str  # the phrase the reader highlighted
    context: str  # the sentence it came from
    kind: str  # grammar | idiom
    explanation: str  # the model's prose, shown on demand
    gloss: str | None = None  # the short answer, shown first when reviewing
    book_id: str = ""
    book_title: str = ""
    page: int | None = None  # where in the book it was highlighted
    created_at: str
    deleted_at: str | None = None

    # Review state (SM-2, three grades). Kept on the word because it is
    # strictly one-to-one; `reviewed_at` is the key the merge turns on.
    due_at: str | None = None
    interval_days: int = 0
    ease: float = 2.5
    reps: int = 0
    lapses: int = 0
    reviewed_at: str | None = None


class SyncPayload(BaseModel):
    """What a device sends up, and what it gets back. The same shape both
    ways, so one round trip settles everything."""

    progress: list[ReadingProgress] = []
    favourites: list[Favourite] = []
    words: list[SavedWord] = []


class SyncResponse(SyncPayload):
    now: str  # the token to send as `since` next time


class Alternative(BaseModel):
    text: str
    note: str | None = None
