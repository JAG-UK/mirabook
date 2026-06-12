import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.ingest.pdf import ingest_pdf
from app.ingest.toc import derive_toc
from app.models import (
    Alternative,
    BlockType,
    BookMeta,
    Explanation,
    Page,
    TranslatedBlock,
)
from app.store.db import Store
from app.translate.factory import get_provider

router = APIRouter()


def _store(req: Request) -> Store:
    return req.app.state.store


def _settings(req: Request):
    return req.app.state.settings


@router.get("/health")
async def health(req: Request):
    s = _settings(req)
    return {
        "status": "ok",
        "provider": s.provider,
        "model": get_provider().model_id,
        "source_lang": s.source_lang,
        "target_lang": s.target_lang,
    }


@router.get("/books", response_model=list[BookMeta])
async def list_books(req: Request):
    return _store(req).list_books()


@router.post("/books", response_model=BookMeta)
async def upload_book(req: Request, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF uploads are supported")
    s = _settings(req)
    book_id = uuid.uuid4().hex[:12]
    media_dir = Path(s.data_dir) / "media" / book_id
    media_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = media_dir / "source.pdf"
    with pdf_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    title = Path(file.filename).stem
    meta, blocks = ingest_pdf(
        pdf_path,
        book_id,
        title,
        media_dir,
        media_url=f"/media/{book_id}",
        source_lang=s.source_lang,
        target_lang=s.target_lang,
    )
    _store(req).save_book(meta, blocks)
    return meta


@router.get("/books/{book_id}", response_model=BookMeta)
async def get_book(req: Request, book_id: str):
    store = _store(req)
    meta = store.get_book(book_id)
    if not meta:
        raise HTTPException(404, "Book not found")
    # If the PDF had no outline, derive a chapter list from detected headings.
    if not meta.toc:
        meta.toc = derive_toc(store.get_headings(book_id), store.body_size(book_id))
    return meta


@router.delete("/books/{book_id}", status_code=204)
async def delete_book(req: Request, book_id: str):
    """Remove a book entirely: its rows (book, blocks, translations) and its
    extracted media (the source PDF + images)."""
    store = _store(req)
    if not store.get_book(book_id):
        raise HTTPException(404, "Book not found")
    store.delete_book(book_id)
    media_dir = Path(_settings(req).data_dir) / "media" / book_id
    shutil.rmtree(media_dir, ignore_errors=True)


def _has_letters(text: str) -> bool:
    """True if the text has anything worth translating. Page numbers, separators
    and the like (no letters) are passed through unchanged — a chatty instruct
    model would otherwise reply 'please provide text to translate'."""
    return any(c.isalpha() for c in text)


async def _translate_map(store, provider, book_id, meta, blocks):
    """Return {block_id: TranslatedBlock} for the given blocks. Letter-free text
    passes through untranslated; the rest is served from cache or translated
    (concurrently across everything missing) and cached."""
    text_blocks = [b for b in blocks if b.type != BlockType.image and b.text.strip()]
    needs = [b for b in text_blocks if _has_letters(b.text)]
    cached = store.get_cached(book_id, [b.id for b in needs], provider.model_id)
    missing = [b for b in needs if b.id not in cached]
    if missing:
        fresh = await provider.translate(missing, meta.source_lang, meta.target_lang)
        store.save_translations(book_id, provider.model_id, fresh)
        cached.update({t.id: t for t in fresh})
    result: dict[str, TranslatedBlock] = dict(cached)
    for b in text_blocks:
        if not _has_letters(b.text):
            result[b.id] = TranslatedBlock(id=b.id, text=b.text)
    return result


@router.get("/books/{book_id}/pages/{page}", response_model=Page)
async def get_page(req: Request, book_id: str, page: int):
    """Return a page's source blocks plus translations, translating any
    uncached blocks on demand and persisting them."""
    store = _store(req)
    meta = store.get_book(book_id)
    if not meta:
        raise HTTPException(404, "Book not found")
    blocks = store.get_page(book_id, page)
    tmap = await _translate_map(store, get_provider(), book_id, meta, blocks)
    return Page(
        number=page,
        blocks=blocks,
        translations=[tmap[b.id] for b in blocks if b.id in tmap],
    )


class TranslatePagesRequest(BaseModel):
    pages: list[int]


@router.post("/books/{book_id}/translate", response_model=list[Page])
async def translate_pages(req: Request, book_id: str, body: TranslatePagesRequest):
    """Translate several pages in one request (used by 'download for offline').
    Uncached blocks across the whole request are translated concurrently."""
    store = _store(req)
    meta = store.get_book(book_id)
    if not meta:
        raise HTTPException(404, "Book not found")
    page_blocks = {n: store.get_page(book_id, n) for n in body.pages}
    all_blocks = [b for blocks in page_blocks.values() for b in blocks]
    tmap = await _translate_map(store, get_provider(), book_id, meta, all_blocks)
    return [
        Page(
            number=n,
            blocks=page_blocks[n],
            translations=[tmap[b.id] for b in page_blocks[n] if b.id in tmap],
        )
        for n in body.pages
    ]


class ExplainRequest(BaseModel):
    text: str
    context: str = ""
    kind: str = "grammar"  # grammar | idiom


@router.post("/explain", response_model=Explanation)
async def explain(req: Request, body: ExplainRequest):
    s = _settings(req)
    return await get_provider().explain(
        body.text, body.context, body.kind, s.source_lang, s.target_lang
    )


class AlternativesRequest(BaseModel):
    text: str
    context: str = ""


@router.post("/alternatives", response_model=list[Alternative])
async def alternatives(req: Request, body: AlternativesRequest):
    s = _settings(req)
    return await get_provider().alternatives(
        body.text, body.context, s.source_lang, s.target_lang
    )
