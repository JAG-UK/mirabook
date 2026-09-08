"""Tests for reader records and the sync merge.

The merge is last-write-wins on each record's own timestamp. That is allowed
to lose one edit made on two devices while both were offline; it is not allowed
to lose a record, resurrect a deleted one, or let an older write clobber a
newer one.
"""

import pytest
from fastapi.testclient import TestClient

from app.models import Favourite, Reader, ReadingProgress, SavedWord, SyncPayload
from app.store.db import Store

EARLY = "2026-09-01T10:00:00+00:00"
LATER = "2026-09-02T10:00:00+00:00"
LATEST = "2026-09-03T10:00:00+00:00"


def reader(id: str = "r1", name: str = "Jon", updated_at: str = EARLY, **kw) -> Reader:
    return Reader(id=id, name=name, avatar="📖", updated_at=updated_at, **kw)


def word(id: str = "w1", **kw) -> SavedWord:
    return SavedWord(
        **{
            "id": id,
            "text": "no se ande con rodeos",
            "context": "Le rogué que no se ande con rodeos.",
            "kind": "idiom",
            "explanation": "A fixed expression.",
            "gloss": "don't beat about the bush",
            "created_at": EARLY,
            **kw,
        }
    )


@pytest.fixture
def store(tmp_path) -> Store:
    s = Store(tmp_path / "sync.db")
    s.save_readers([reader()])
    yield s
    s.close()


def sync(store: Store, since=None, **payload) -> SyncPayload:
    return store.sync("r1", since, SyncPayload(**payload))


# --- readers ---


def test_readers_start_empty(tmp_path):
    s = Store(tmp_path / "empty.db")
    try:
        assert s.list_readers() == []
    finally:
        s.close()


def test_a_reader_is_remembered(store: Store):
    assert [r.name for r in store.list_readers()] == ["Jon"]


def test_a_later_rename_wins(store: Store):
    store.save_readers([reader(name="Jonathan", updated_at=LATER)])
    assert [r.name for r in store.list_readers()] == ["Jonathan"]


def test_an_older_rename_is_ignored(store: Store):
    """A device that has been offline must not undo a newer change."""
    store.save_readers([reader(name="Jonathan", updated_at=LATER)])
    store.save_readers([reader(name="Stale", updated_at=EARLY)])
    assert [r.name for r in store.list_readers()] == ["Jonathan"]


def test_a_removed_reader_disappears_but_is_still_recorded(store: Store):
    store.save_readers([reader(updated_at=LATER, deleted_at=LATER)])
    assert store.list_readers() == []
    # The tombstone survives, so another device learns of the removal.
    assert [r.id for r in store.list_readers(include_deleted=True)] == ["r1"]


def test_readers_from_two_devices_are_merged_not_replaced(store: Store):
    store.save_readers([reader(id="r2", name="Ana")])
    assert {r.name for r in store.list_readers()} == {"Jon", "Ana"}


# --- reading progress ---


def test_progress_is_stored_and_returned(store: Store):
    sync(store, progress=[ReadingProgress(book_id="bk1", page=42, updated_at=EARLY)])
    out = sync(store)
    assert [(p.book_id, p.page) for p in out.progress] == [("bk1", 42)]


def test_a_later_page_wins(store: Store):
    sync(store, progress=[ReadingProgress(book_id="bk1", page=42, updated_at=EARLY)])
    sync(store, progress=[ReadingProgress(book_id="bk1", page=99, updated_at=LATER)])
    assert sync(store).progress[0].page == 99


def test_an_older_page_does_not_clobber_a_newer_one(store: Store):
    """The phone was offline on page 12 while the tablet reached page 99."""
    sync(store, progress=[ReadingProgress(book_id="bk1", page=99, updated_at=LATER)])
    sync(store, progress=[ReadingProgress(book_id="bk1", page=12, updated_at=EARLY)])
    assert sync(store).progress[0].page == 99


def test_progress_is_kept_per_book(store: Store):
    sync(
        store,
        progress=[
            ReadingProgress(book_id="bk1", page=42, updated_at=EARLY),
            ReadingProgress(book_id="bk2", page=7, updated_at=EARLY),
        ],
    )
    assert {p.book_id: p.page for p in sync(store).progress} == {"bk1": 42, "bk2": 7}


# --- favourites ---


def test_a_favourite_round_trips(store: Store):
    sync(store, favourites=[Favourite(book_id="bk1", created_at=EARLY)])
    assert [f.book_id for f in sync(store).favourites] == ["bk1"]


def test_un_starring_is_a_tombstone_not_a_deletion(store: Store):
    sync(store, favourites=[Favourite(book_id="bk1", created_at=EARLY)])
    sync(store, favourites=[Favourite(book_id="bk1", created_at=EARLY, deleted_at=LATER)])

    out = sync(store)
    assert out.favourites[0].deleted_at == LATER  # the removal is carried, not lost


def test_a_stale_device_cannot_resurrect_an_un_starred_book(store: Store):
    sync(store, favourites=[Favourite(book_id="bk1", created_at=EARLY, deleted_at=LATER)])
    # A device that still thinks it is starred, from before the removal.
    sync(store, favourites=[Favourite(book_id="bk1", created_at=EARLY)])
    assert sync(store).favourites[0].deleted_at == LATER


# --- saved words ---


def test_a_saved_word_round_trips_with_its_gloss(store: Store):
    sync(store, words=[word()])
    got = sync(store).words[0]
    assert got.text == "no se ande con rodeos"
    assert got.gloss == "don't beat about the bush"
    assert got.kind == "idiom"


def test_a_word_remembers_the_page_it_came_from(store: Store):
    sync(store, words=[word(page=42)])
    assert sync(store).words[0].page == 42


def test_a_word_saved_before_pages_were_recorded_is_still_fine(store: Store):
    sync(store, words=[word()])
    assert sync(store).words[0].page is None


def test_review_state_round_trips(store: Store):
    sync(
        store,
        words=[word(due_at=LATEST, interval_days=6, ease=2.6, reps=3, lapses=1, reviewed_at=LATER)],
    )
    got = sync(store).words[0]
    assert (got.interval_days, got.reps, got.lapses) == (6, 3, 1)
    assert got.ease == 2.6
    assert got.due_at == LATEST


def test_the_later_review_wins(store: Store):
    sync(store, words=[word(reps=1, reviewed_at=EARLY)])
    sync(store, words=[word(reps=2, reviewed_at=LATER)])
    assert sync(store).words[0].reps == 2


def test_an_older_review_does_not_undo_a_newer_one(store: Store):
    sync(store, words=[word(reps=5, reviewed_at=LATER)])
    sync(store, words=[word(reps=1, reviewed_at=EARLY)])
    assert sync(store).words[0].reps == 5


def test_a_deleted_word_stays_deleted(store: Store):
    sync(store, words=[word()])
    sync(store, words=[word(deleted_at=LATER)])
    sync(store, words=[word()])  # a stale device that still has it
    assert sync(store).words[0].deleted_at == LATER


def test_words_are_kept_per_reader(store: Store):
    store.save_readers([reader(id="r2", name="Ana")])
    store.sync("r1", None, SyncPayload(words=[word(id="w1")]))
    store.sync("r2", None, SyncPayload(words=[word(id="w2")]))

    assert [w.id for w in store.sync("r1", None, SyncPayload()).words] == ["w1"]
    assert [w.id for w in store.sync("r2", None, SyncPayload()).words] == ["w2"]


# --- the since token ---


def test_without_a_token_everything_comes_back(store: Store):
    """What a new device asks for."""
    sync(store, words=[word()], progress=[ReadingProgress(book_id="b", page=1, updated_at=EARLY)])
    out = sync(store, since=None)
    assert len(out.words) == 1 and len(out.progress) == 1


def test_a_token_holds_back_what_the_device_already_has(store: Store):
    sync(store, words=[word(created_at=EARLY)])
    assert sync(store, since=LATER).words == []


def test_only_what_changed_since_the_token_comes_back(store: Store):
    sync(store, words=[word(id="old", created_at=EARLY), word(id="new", created_at=LATEST)])
    assert [w.id for w in sync(store, since=LATER).words] == ["new"]


def test_a_review_makes_an_old_word_change_again(store: Store):
    """The word was created long ago, but reviewing it is a change."""
    sync(store, words=[word(created_at=EARLY)])
    sync(store, words=[word(created_at=EARLY, reviewed_at=LATEST)])
    assert [w.id for w in sync(store, since=LATER).words] == ["w1"]


def test_a_timestamp_spelled_with_z_is_understood(store: Store):
    """Browsers hand out `toISOString()`, which ends in Z."""
    sync(store, progress=[ReadingProgress(book_id="bk1", page=5, updated_at="2026-09-02T10:00:00Z")])
    sync(store, progress=[ReadingProgress(book_id="bk1", page=3, updated_at=EARLY)])
    assert sync(store).progress[0].page == 5


def test_two_devices_converge(store: Store):
    """Each syncs its own change and ends up holding both."""
    phone = sync(store, words=[word(id="from-phone")])
    assert [w.id for w in phone.words] == ["from-phone"]

    tablet = sync(store, since=None, words=[word(id="from-tablet")])
    assert {w.id for w in tablet.words} == {"from-phone", "from-tablet"}


# --- through the API ---


def test_sync_endpoint_merges_and_returns_a_token(client: TestClient):
    client.put("/api/readers", json=[reader().model_dump(mode="json")])
    r = client.post(
        "/api/readers/r1/sync",
        json={"words": [word().model_dump(mode="json")], "progress": [], "favourites": []},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["now"]
    assert [w["id"] for w in body["words"]] == ["w1"]


def test_syncing_an_unknown_reader_is_404(client: TestClient):
    r = client.post("/api/readers/nobody/sync", json={"progress": [], "favourites": [], "words": []})
    assert r.status_code == 404


def test_readers_can_be_listed_and_saved_over_the_api(client: TestClient):
    assert client.get("/api/readers").json() == []
    saved = client.put("/api/readers", json=[reader().model_dump(mode="json")]).json()
    assert [r["name"] for r in saved] == ["Jon"]
    assert [r["name"] for r in client.get("/api/readers").json()] == ["Jon"]
