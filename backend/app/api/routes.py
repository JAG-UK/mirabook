import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.ingest.pdf import ingest_pdf
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
    meta = _store(req).get_book(book_id)
    if not meta:
        raise HTTPException(404, "Book not found")
    return meta


@router.get("/books/{book_id}/pages/{page}", response_model=Page)
async def get_page(req: Request, book_id: str, page: int):
    """Return a page's source blocks plus translations, translating any
    uncached blocks on demand and persisting them."""
    store = _store(req)
    meta = store.get_book(book_id)
    if not meta:
        raise HTTPException(404, "Book not found")
    blocks = store.get_page(book_id, page)
    provider = get_provider()

    translatable = [b for b in blocks if b.type != BlockType.image and b.text.strip()]
    cached = store.get_cached(book_id, [b.id for b in translatable], provider.model_id)
    missing = [b for b in translatable if b.id not in cached]
    if missing:
        fresh = await provider.translate(missing, meta.source_lang, meta.target_lang)
        store.save_translations(book_id, provider.model_id, fresh)
        cached.update({t.id: t for t in fresh})

    translations: list[TranslatedBlock] = [
        cached[b.id] for b in translatable if b.id in cached
    ]
    return Page(number=page, blocks=blocks, translations=translations)


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
