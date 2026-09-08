import asyncio
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.ingest.pdf import ingest_document
from app.ingest.toc import derive_toc
from app.shelves import SHELVES, UNSHELVED, normalize_shelf
from app.models import (
    Alternative,
    BlockType,
    BookMeta,
    Explanation,
    Page,
    Reader,
    SyncPayload,
    SyncResponse,
    TranslatedBlock,
)
from app.store.db import Store, now_iso
from app.translate.factory import get_provider

router = APIRouter()


def _store(req: Request) -> Store:
    return req.app.state.store


def _settings(req: Request):
    return req.app.state.settings


@router.get("/health")
async def health(req: Request):
    """Provider status, including whether the configured model is actually
    available — so a missing model shows up here rather than the first time
    somebody opens a book."""
    s = _settings(req)
    provider = get_provider()
    body = {
        "status": "ok",
        "provider": s.provider,
        "model": provider.model_id,
        "source_lang": s.source_lang,
        "target_lang": s.target_lang,
    }
    ready = getattr(provider, "ensure_ready", None)
    if ready:
        try:
            await ready()
        except RuntimeError as e:
            body["status"] = "model unavailable"
            body["detail"] = str(e)
    return body


@router.get("/books", response_model=list[BookMeta])
async def list_books(req: Request):
    return _store(req).list_books()


@router.get("/readers", response_model=list[Reader])
async def list_readers(req: Request):
    """Who reads on this Mirabook. Held centrally so a phone and a tablet show
    the same people — not accounts: the app has one password."""
    return _store(req).list_readers()


@router.put("/readers", response_model=list[Reader])
async def save_readers(req: Request, readers: list[Reader]):
    """Merge a device's view of the reader list and return the merged result.
    Renames, new readers and removals all arrive this way; a removal is a
    `deleted_at` rather than a delete, so it survives the trip."""
    return _store(req).save_readers(readers)


@router.post("/readers/{reader_id}/sync", response_model=SyncResponse)
async def sync(req: Request, reader_id: str, body: SyncPayload, since: str | None = None):
    """Exchange one reader's records in a single round trip.

    The device sends whatever it has changed and the token from its last sync;
    it gets back everything changed since. Omitting `since` asks for the lot,
    which is what a new device does.
    """
    store = _store(req)
    if not any(r.id == reader_id for r in store.list_readers()):
        raise HTTPException(404, "Reader not found")
    # Read the clock before merging: anything written during this call must
    # look newer than the token we hand back, or the next sync will skip it.
    token = now_iso()
    changed = store.sync(reader_id, since, body)
    return SyncResponse(now=token, **changed.model_dump())


class Shelf(BaseModel):
    name: str
    count: int


@router.get("/shelves", response_model=list[Shelf])
async def list_shelves(req: Request, all: bool = False):
    """The themed shelves, in display order.

    By default only shelves holding something, which is what the library's
    filter chips want. `?all=true` returns every shelf in the taxonomy,
    including empty ones — what the editor needs to offer as choices.

    Serving the canonical order from the backend keeps the library UI from
    drifting out of step with `app.shelves`.
    """
    counts = _store(req).shelf_counts()
    shelves = [Shelf(name=n, count=counts.get(n, 0)) for n in SHELVES if all or counts.get(n)]
    if all or counts.get(""):
        shelves.append(Shelf(name=UNSHELVED, count=counts.get("", 0)))
    return shelves


SUPPORTED_UPLOADS = (".pdf", ".epub")


@router.post("/books", response_model=BookMeta)
async def upload_book(req: Request, file: UploadFile = File(...)):
    name = (file.filename or "").lower()
    ext = next((e for e in SUPPORTED_UPLOADS if name.endswith(e)), None)
    if not ext:
        raise HTTPException(400, "Only PDF and EPUB uploads are supported")
    s = _settings(req)
    book_id = uuid.uuid4().hex[:12]
    media_dir = Path(s.data_dir) / "media" / book_id
    media_dir.mkdir(parents=True, exist_ok=True)
    src_path = media_dir / f"source{ext}"
    with src_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    title = Path(file.filename).stem
    meta, blocks = ingest_document(
        src_path,
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


class BookUpdate(BaseModel):
    """A partial edit. An omitted field is left alone; an explicit null clears
    it — so "no author" and "don't touch the author" stay distinguishable."""

    title: str | None = None
    author: str | None = None
    shelf: str | None = None


@router.patch("/books/{book_id}", response_model=BookMeta)
async def update_book(req: Request, book_id: str, body: BookUpdate):
    """Correct a book's title, author or shelf.

    Ingest guesses all three — from a filename, a catalogue row, or a model —
    and is sometimes wrong, so they need to be fixable without a re-import.
    """
    store = _store(req)
    if not store.get_book(book_id):
        raise HTTPException(404, "Book not found")

    fields = body.model_dump(exclude_unset=True)
    if "title" in fields:
        title = (fields["title"] or "").strip()
        if not title:
            raise HTTPException(400, "A book needs a title")
        fields["title"] = title
    if "author" in fields:
        fields["author"] = (fields["author"] or "").strip() or None
    if "shelf" in fields:
        raw = (fields["shelf"] or "").strip()
        # An unknown shelf would show in the library as a category of one.
        if raw and raw != UNSHELVED:
            shelf = normalize_shelf(raw)
            if shelf is None:
                raise HTTPException(400, f"{raw!r} is not one of the shelves")
            fields["shelf"] = shelf
        else:
            fields["shelf"] = None

    store.update_book(book_id, fields)
    return store.get_book(book_id)


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
    """Explain a highlighted phrase, and gloss it in a few words.

    Both come from the same model looking at the same sentence, and run
    concurrently so the gloss is close to free in wall-clock terms. The gloss
    is what a review card shows first — a paragraph of prose tells you the
    answer before you can judge whether you knew it.
    """
    s = _settings(req)
    provider = get_provider()
    explanation, gloss = await asyncio.gather(
        provider.explain(body.text, body.context, body.kind, s.source_lang, s.target_lang),
        provider.gloss(body.text, body.context, s.source_lang, s.target_lang),
        return_exceptions=True,
    )
    if isinstance(explanation, BaseException):
        raise explanation
    # A missing gloss is a smaller loss than a failed lookup, so it is allowed
    # to come back empty rather than taking the explanation down with it.
    explanation.gloss = None if isinstance(gloss, BaseException) else (gloss.strip() or None)
    return explanation


class AlternativesRequest(BaseModel):
    text: str
    context: str = ""


@router.post("/alternatives", response_model=list[Alternative])
async def alternatives(req: Request, body: AlternativesRequest):
    s = _settings(req)
    return await get_provider().alternatives(
        body.text, body.context, s.source_lang, s.target_lang
    )
