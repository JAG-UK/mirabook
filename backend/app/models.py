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


class Explanation(BaseModel):
    kind: str  # grammar | idiom
    text: str


class Alternative(BaseModel):
    text: str
    note: str | None = None
