"""Tests for the HTTP API, driven through FastAPI's TestClient against a stub
translation provider so nothing here needs Ollama (or a network)."""

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.config import get_settings
from app.models import Block, BlockType, BookMeta, TocEntry
from tests.conftest import SAMPLE, StubProvider


def seed_book(client: TestClient, book_id: str = "bk1") -> BookMeta:
    """Put a small synthetic book straight into the store — faster than
    ingesting a PDF, and lets a test choose exactly which blocks exist."""
    meta = BookMeta(
        id=book_id,
        title="Sintético",
        source_lang="Spanish",
        target_lang="English",
        page_count=2,
        toc=[TocEntry(title="Capítulo I", page=1, level=1)],
    )
    blocks = [
        Block(
            id="p1-b0", page=1, order=0, type=BlockType.heading,
            text="Capítulo I", level=1, size=20.0,
        ),
        Block(id="p1-b1", page=1, order=1, type=BlockType.paragraph, text="En un lugar", size=11.0),
        Block(
            id="p1-b2", page=1, order=2, type=BlockType.image,
            src=f"/media/{book_id}/images/a.png",
        ),
        Block(id="p1-b3", page=1, order=3, type=BlockType.paragraph, text="— 42 —", size=11.0),
        Block(
            id="p2-b4", page=2, order=4, type=BlockType.paragraph, text="de la Mancha", size=11.0
        ),
    ]
    client.app.state.store.save_book(meta, blocks)
    return meta


# --- health ---


def test_health_reports_provider_and_languages(client: TestClient):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["model"] == "stub:v1"
    assert body["source_lang"] == "Spanish"
    assert body["target_lang"] == "English"


# --- library ---


def test_books_list_is_empty_before_any_upload(client: TestClient):
    assert client.get("/api/books").json() == []


def test_library_lists_saved_books(client: TestClient):
    seed_book(client)
    assert [b["id"] for b in client.get("/api/books").json()] == ["bk1"]


# --- shelves ---


def test_shelves_are_empty_for_an_empty_library(client: TestClient):
    assert client.get("/api/shelves").json() == []


def test_shelves_are_counted_and_returned_in_canonical_order(client: TestClient):
    """Display order comes from app.shelves, not from insertion or count."""
    store = client.app.state.store
    for i, shelf in enumerate(["History", "Novels", "Poetry", "Novels"]):
        store.save_book(
            BookMeta(
                id=f"b{i}", title=f"Libro {i}", source_lang="Spanish",
                target_lang="English", page_count=1, shelf=shelf,
            ),
            [],
        )
    body = client.get("/api/shelves").json()
    assert body == [
        {"name": "Novels", "count": 2},
        {"name": "Poetry", "count": 1},
        {"name": "History", "count": 1},
    ]


def test_books_without_a_shelf_are_reported_as_unshelved(client: TestClient):
    seed_book(client)  # seeded with no shelf
    assert client.get("/api/shelves").json() == [{"name": "Unshelved", "count": 1}]


def test_book_metadata_carries_author_shelf_and_provenance(client: TestClient):
    store = client.app.state.store
    store.save_book(
        BookMeta(
            id="bk9", title="Niebla", source_lang="Spanish", target_lang="English",
            page_count=3, author="Unamuno, Miguel de", shelf="Novels",
            source="gutenberg:49836",
        ),
        [],
    )
    book = client.get("/api/books/bk9").json()
    assert book["author"] == "Unamuno, Miguel de"
    assert book["shelf"] == "Novels"
    assert book["source"] == "gutenberg:49836"


@pytest.mark.parametrize("filename", ["notes.txt", "book.mobi", "noextension"])
def test_upload_rejects_unsupported_file_types(client: TestClient, filename):
    r = client.post("/api/books", files={"file": (filename, b"data", "application/octet-stream")})
    assert r.status_code == 400
    assert "PDF and EPUB" in r.json()["detail"]


def test_upload_ingests_a_pdf_and_stores_its_source(client: TestClient, tmp_path):
    with SAMPLE.open("rb") as f:
        r = client.post("/api/books", files={"file": ("don-quijote-es.pdf", f, "application/pdf")})
    assert r.status_code == 200
    meta = r.json()
    assert meta["title"] == "don-quijote-es"
    assert meta["page_count"] > 1
    assert meta["source_lang"] == "Spanish"
    # The uploaded file is kept so the book can be re-ingested later.
    assert (tmp_path / "media" / meta["id"] / "source.pdf").is_file()
    assert [b["id"] for b in client.get("/api/books").json()] == [meta["id"]]


def test_get_book_returns_metadata_and_toc(client: TestClient):
    seed_book(client)
    body = client.get("/api/books/bk1").json()
    assert body["title"] == "Sintético"
    assert body["toc"] == [{"title": "Capítulo I", "page": 1, "level": 1}]


def test_get_book_derives_a_toc_when_none_was_stored(client: TestClient):
    """A book ingested without an outline gets chapters derived from headings."""
    meta = BookMeta(
        id="bk2", title="Sin índice", source_lang="Spanish",
        target_lang="English", page_count=2, toc=[],
    )
    blocks = [
        Block(
            id="p1-b0", page=1, order=0, type=BlockType.heading,
            text="Capítulo I", level=1, size=20.0,
        ),
        Block(id="p1-b1", page=1, order=1, type=BlockType.paragraph, text="En un lugar", size=11.0),
        Block(
            id="p2-b2", page=2, order=2, type=BlockType.heading,
            text="Capítulo II", level=1, size=20.0,
        ),
    ]
    client.app.state.store.save_book(meta, blocks)

    toc = client.get("/api/books/bk2").json()["toc"]
    assert [t["title"] for t in toc] == ["Capítulo I", "Capítulo II"]
    assert [t["page"] for t in toc] == [1, 2]


def test_unknown_book_is_404_on_every_route(client: TestClient):
    assert client.get("/api/books/nope").status_code == 404
    assert client.get("/api/books/nope/pages/1").status_code == 404
    assert client.delete("/api/books/nope").status_code == 404
    assert client.post("/api/books/nope/translate", json={"pages": [1]}).status_code == 404


# --- editing labels ---


def seed_labelled(client: TestClient) -> None:
    client.app.state.store.save_book(
        BookMeta(
            id="bk1", title="don-quijote-es", source_lang="Spanish", target_lang="English",
            page_count=32, author="Cervantes", shelf="History", source="gutenberg:2000",
        ),
        [],
    )


def test_a_book_can_be_retitled(client: TestClient):
    seed_labelled(client)
    body = client.patch("/api/books/bk1", json={"title": "  Don Quijote  "}).json()
    assert body["title"] == "Don Quijote"
    # ...and nothing else moved.
    assert body["author"] == "Cervantes"
    assert body["shelf"] == "History"
    assert body["source"] == "gutenberg:2000"


def test_omitted_fields_are_left_alone(client: TestClient):
    seed_labelled(client)
    client.patch("/api/books/bk1", json={"author": "Miguel de Cervantes"})
    book = client.get("/api/books/bk1").json()
    assert book["author"] == "Miguel de Cervantes"
    assert book["title"] == "don-quijote-es"
    assert book["shelf"] == "History"


def test_a_misfiled_book_can_be_moved_to_another_shelf(client: TestClient):
    seed_labelled(client)
    assert client.patch("/api/books/bk1", json={"shelf": "Novels"}).json()["shelf"] == "Novels"
    assert client.get("/api/shelves").json() == [{"name": "Novels", "count": 1}]


def test_shelf_names_are_matched_loosely_but_stored_canonically(client: TestClient):
    seed_labelled(client)
    assert client.patch("/api/books/bk1", json={"shelf": "novels"}).json()["shelf"] == "Novels"


@pytest.mark.parametrize("cleared", [None, "", "   "])
def test_an_author_can_be_cleared(client: TestClient, cleared):
    seed_labelled(client)
    assert client.patch("/api/books/bk1", json={"author": cleared}).json()["author"] is None


@pytest.mark.parametrize("cleared", [None, "", "Unshelved"])
def test_a_book_can_be_taken_off_its_shelf(client: TestClient, cleared):
    seed_labelled(client)
    assert client.patch("/api/books/bk1", json={"shelf": cleared}).json()["shelf"] is None
    assert client.get("/api/shelves").json() == [{"name": "Unshelved", "count": 1}]


@pytest.mark.parametrize("bad", [None, "", "   "])
def test_a_book_cannot_be_left_without_a_title(client: TestClient, bad):
    seed_labelled(client)
    assert client.patch("/api/books/bk1", json={"title": bad}).status_code == 400
    assert client.get("/api/books/bk1").json()["title"] == "don-quijote-es"


def test_an_invented_shelf_is_refused(client: TestClient):
    """Otherwise the library grows a category holding exactly one book."""
    seed_labelled(client)
    r = client.patch("/api/books/bk1", json={"shelf": "Bangers"})
    assert r.status_code == 400
    assert "Bangers" in r.json()["detail"]
    assert client.get("/api/books/bk1").json()["shelf"] == "History"


def test_patching_an_unknown_book_is_404(client: TestClient):
    assert client.patch("/api/books/nope", json={"title": "x"}).status_code == 404


def test_an_empty_patch_changes_nothing(client: TestClient):
    seed_labelled(client)
    assert client.patch("/api/books/bk1", json={}).json()["title"] == "don-quijote-es"


def test_editing_labels_leaves_the_pages_intact(client: TestClient):
    """Renaming a book must not disturb its blocks or cached translations."""
    seed_book(client)
    client.get("/api/books/bk1/pages/1")
    client.patch("/api/books/bk1", json={"title": "Nuevo título", "shelf": "Poetry"})
    page = client.get("/api/books/bk1/pages/1").json()
    assert [b["id"] for b in page["blocks"]] == ["p1-b0", "p1-b1", "p1-b2", "p1-b3"]
    assert {t["id"]: t["text"] for t in page["translations"]}["p1-b1"] == "EN UN LUGAR"


# --- the editor's shelf choices ---


def test_all_shelves_are_offered_for_editing_even_when_empty(client: TestClient):
    seed_labelled(client)
    chips = client.get("/api/shelves").json()
    choices = client.get("/api/shelves?all=true").json()
    assert [c["name"] for c in chips] == ["History"]
    names = [c["name"] for c in choices]
    assert "Novels" in names and "Poetry" in names and names[-1] == "Unshelved"
    assert next(c for c in choices if c["name"] == "History")["count"] == 1
    assert next(c for c in choices if c["name"] == "Poetry")["count"] == 0


# --- deletion ---


def test_delete_removes_the_book_its_translations_and_its_media(client: TestClient, tmp_path):
    seed_book(client)
    client.get("/api/books/bk1/pages/1")
    media = tmp_path / "media" / "bk1"
    media.mkdir(parents=True, exist_ok=True)
    (media / "source.pdf").write_bytes(b"pdf")

    assert client.delete("/api/books/bk1").status_code == 204

    assert client.get("/api/books/bk1").status_code == 404
    assert client.get("/api/books").json() == []
    assert not media.exists()
    store = client.app.state.store
    assert store.get_cached("bk1", ["p1-b1"], "stub:v1") == {}


# --- pages + translation ---


def test_get_page_returns_blocks_with_aligned_translations(client: TestClient):
    seed_book(client)
    body = client.get("/api/books/bk1/pages/1").json()

    assert body["number"] == 1
    assert [b["id"] for b in body["blocks"]] == ["p1-b0", "p1-b1", "p1-b2", "p1-b3"]
    by_id = {t["id"]: t["text"] for t in body["translations"]}
    assert by_id["p1-b0"] == "CAPÍTULO I"
    assert by_id["p1-b1"] == "EN UN LUGAR"
    # Images carry no translation; the alignment key is simply absent.
    assert "p1-b2" not in by_id


def test_letter_free_text_is_passed_through_untranslated(
    client: TestClient, provider: StubProvider
):
    """Page numbers and separators would make a chatty model editorialise."""
    seed_book(client)
    body = client.get("/api/books/bk1/pages/1").json()

    assert {t["id"]: t["text"] for t in body["translations"]}["p1-b3"] == "— 42 —"
    assert "— 42 —" not in provider.translated


def test_translations_are_cached_after_the_first_request(
    client: TestClient, provider: StubProvider
):
    seed_book(client)
    client.get("/api/books/bk1/pages/1")
    assert sorted(provider.translated) == ["Capítulo I", "En un lugar"]

    provider.translated.clear()
    second = client.get("/api/books/bk1/pages/1").json()
    assert provider.translated == []
    assert {t["id"]: t["text"] for t in second["translations"]}["p1-b1"] == "EN UN LUGAR"


def test_a_new_model_id_invalidates_the_cache(
    client: TestClient, provider: StubProvider, monkeypatch
):
    """Switching model — or bumping PROMPT_VERSION — re-translates the page."""
    seed_book(client)
    client.get("/api/books/bk1/pages/1")

    newer = StubProvider("stub:v2")
    monkeypatch.setattr(routes, "get_provider", lambda: newer)
    client.get("/api/books/bk1/pages/1")
    assert sorted(newer.translated) == ["Capítulo I", "En un lugar"]


def test_an_empty_page_returns_no_blocks(client: TestClient):
    seed_book(client)
    body = client.get("/api/books/bk1/pages/99").json()
    assert body["blocks"] == []
    assert body["translations"] == []


def test_batch_translate_returns_pages_in_the_requested_order(client: TestClient):
    seed_book(client)
    pages = client.post("/api/books/bk1/translate", json={"pages": [2, 1]}).json()

    assert [p["number"] for p in pages] == [2, 1]
    assert {t["id"]: t["text"] for t in pages[0]["translations"]}["p2-b4"] == "DE LA MANCHA"
    assert [b["id"] for b in pages[1]["blocks"]] == ["p1-b0", "p1-b1", "p1-b2", "p1-b3"]


def test_batch_translate_shares_the_cache_with_single_page_reads(
    client: TestClient, provider: StubProvider
):
    seed_book(client)
    client.post("/api/books/bk1/translate", json={"pages": [1, 2]})
    provider.translated.clear()

    client.get("/api/books/bk1/pages/2")
    assert provider.translated == []


# --- reading aids ---


@pytest.mark.parametrize("kind", ["grammar", "idiom"])
def test_explain_passes_kind_and_languages_through(client: TestClient, kind):
    body = client.post(
        "/api/explain", json={"text": "se lo dije", "context": "Ya se lo dije.", "kind": kind}
    ).json()
    assert body["kind"] == kind
    assert "'se lo dije'" in body["text"]
    assert "Spanish->English" in body["text"]


def test_explain_also_returns_a_short_gloss(client: TestClient):
    """The gloss is the answer side of a review card; the prose is the detail
    behind it."""
    body = client.post("/api/explain", json={"text": "se lo dije", "context": "Ya."}).json()
    assert body["gloss"] == "gloss of se lo dije"
    assert body["text"]


def test_a_failed_gloss_does_not_take_the_explanation_with_it(client: TestClient, provider):
    async def no_gloss(*_args, **_kwargs):
        raise RuntimeError("model said no")

    provider.gloss = no_gloss
    body = client.post("/api/explain", json={"text": "se lo dije", "context": "Ya."}).json()
    assert body["gloss"] is None
    assert "se lo dije" in body["text"]


def test_a_failed_explanation_is_still_an_error(client: TestClient, provider):
    async def boom(*_args, **_kwargs):
        raise RuntimeError("model said no")

    provider.explain = boom
    with pytest.raises(RuntimeError):
        client.post("/api/explain", json={"text": "x", "context": "y"})


def test_alternatives_returns_the_option_list(client: TestClient):
    body = client.post("/api/alternatives", json={"text": "de la Mancha"}).json()
    assert [a["text"] for a in body] == ["DE LA MANCHA", "loose"]
    assert body[0]["note"] == "literal"


# --- basic auth ---


def test_basic_auth_guards_every_route_when_configured(tmp_path, monkeypatch, provider):
    monkeypatch.setenv("MIRABOOK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MIRABOOK_BASIC_AUTH", "reader:s3cret")
    get_settings.cache_clear()
    from app.main import create_app

    try:
        with TestClient(create_app()) as c:
            unauthorized = c.get("/api/health")
            assert unauthorized.status_code == 401
            assert unauthorized.headers["www-authenticate"].startswith("Basic")

            assert c.get("/api/health", auth=("reader", "wrong")).status_code == 401
            assert c.get("/api/health", auth=("reader", "s3cret")).status_code == 200
    finally:
        get_settings.cache_clear()
