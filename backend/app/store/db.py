import json
import sqlite3
import threading
from pathlib import Path

from datetime import datetime, timezone

from app.models import (
    Block,
    BlockType,
    BookMeta,
    Favourite,
    Reader,
    ReadingProgress,
    SavedWord,
    SyncPayload,
    TocEntry,
    TranslatedBlock,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _at(value: str | None) -> datetime | None:
    """Parse a timestamp from a client, which may or may not spell UTC as 'Z'."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _newer(incoming: str | None, existing: str | None) -> bool:
    """Last write wins, and a record we have never seen always wins."""
    if existing is None:
        return True
    a, b = _at(incoming), _at(existing)
    if a is None:
        return False
    return b is None or a > b

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  toc_json TEXT NOT NULL DEFAULT '[]',
  author TEXT,
  shelf TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS blocks (
  book_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  level INTEGER,
  size REAL,
  src TEXT,
  bbox_json TEXT,
  PRIMARY KEY (book_id, block_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(book_id, page, ord);
CREATE TABLE IF NOT EXISTS readers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS reading_progress (
  reader_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (reader_id, book_id)
);
CREATE TABLE IF NOT EXISTS favourites (
  reader_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (reader_id, book_id)
);
CREATE TABLE IF NOT EXISTS saved_words (
  id TEXT PRIMARY KEY,
  reader_id TEXT NOT NULL,
  text TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'grammar',
  explanation TEXT NOT NULL DEFAULT '',
  gloss TEXT,
  book_id TEXT NOT NULL DEFAULT '',
  book_title TEXT NOT NULL DEFAULT '',
  page INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  due_at TEXT,
  interval_days INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_words_reader ON saved_words(reader_id, due_at);
CREATE TABLE IF NOT EXISTS translations (
  book_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  text TEXT NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (book_id, block_id, model_id)
);
"""


class Store:
    """Thin SQLite wrapper. Persists ingested books/blocks and caches
    translations keyed by (book_id, block_id, model_id) so each block is
    translated at most once per model."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._migrate()
        self._conn.commit()
        self._lock = threading.Lock()

    def _migrate(self) -> None:
        """Add columns introduced after a DB was first created."""
        cols = {r[1] for r in self._conn.execute("PRAGMA table_info(blocks)")}
        if "size" not in cols:
            self._conn.execute("ALTER TABLE blocks ADD COLUMN size REAL")
        book_cols = {r[1] for r in self._conn.execute("PRAGMA table_info(books)")}
        for name, decl in (("author", "TEXT"), ("shelf", "TEXT"), ("source", "TEXT")):
            if name not in book_cols:
                self._conn.execute(f"ALTER TABLE books ADD COLUMN {name} {decl}")
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_books_source ON books(source)")
        word_cols = {r[1] for r in self._conn.execute("PRAGMA table_info(saved_words)")}
        if word_cols and "page" not in word_cols:
            self._conn.execute("ALTER TABLE saved_words ADD COLUMN page INTEGER")

    def close(self) -> None:
        self._conn.close()

    # --- books ---
    def save_book(self, meta: BookMeta, blocks: list[Block]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO books "
                "(id, title, source_lang, target_lang, page_count, toc_json, "
                "author, shelf, source) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    meta.id,
                    meta.title,
                    meta.source_lang,
                    meta.target_lang,
                    meta.page_count,
                    json.dumps([t.model_dump() for t in meta.toc]),
                    meta.author,
                    meta.shelf,
                    meta.source,
                ),
            )
            self._conn.execute("DELETE FROM blocks WHERE book_id = ?", (meta.id,))
            self._conn.executemany(
                "INSERT INTO blocks "
                "(book_id, block_id, page, ord, type, text, level, size, src, bbox_json) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        meta.id,
                        b.id,
                        b.page,
                        b.order,
                        b.type.value,
                        b.text,
                        b.level,
                        b.size,
                        b.src,
                        json.dumps(b.bbox) if b.bbox else None,
                    )
                    for b in blocks
                ],
            )
            self._conn.commit()

    def delete_book(self, book_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM translations WHERE book_id = ?", (book_id,))
            self._conn.execute("DELETE FROM blocks WHERE book_id = ?", (book_id,))
            self._conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
            self._conn.commit()

    def sources(self) -> set[str]:
        """Every recorded provenance string — lets a bulk import resume."""
        rows = self._conn.execute(
            "SELECT source FROM books WHERE source IS NOT NULL"
        ).fetchall()
        return {r["source"] for r in rows}

    def shelf_counts(self) -> dict[str, int]:
        """How many books sit on each shelf. Books with no shelf are counted
        under the empty string so the caller can label them as it likes."""
        rows = self._conn.execute(
            "SELECT COALESCE(shelf, '') AS shelf, COUNT(*) AS n FROM books GROUP BY 1"
        ).fetchall()
        return {r["shelf"]: r["n"] for r in rows}

    # The only book columns a reader may edit. Whitelisted rather than
    # interpolated, since these names reach an UPDATE statement.
    EDITABLE = ("title", "author", "shelf")

    def update_book(self, book_id: str, fields: dict[str, str | None]) -> None:
        """Set some subset of a book's labels, leaving the rest alone."""
        changes = {k: v for k, v in fields.items() if k in self.EDITABLE}
        if not changes:
            return
        assignments = ", ".join(f"{k} = ?" for k in changes)
        with self._lock:
            self._conn.execute(
                f"UPDATE books SET {assignments} WHERE id = ?",
                (*changes.values(), book_id),
            )
            self._conn.commit()

    def set_shelf(self, book_id: str, shelf: str | None) -> None:
        self.update_book(book_id, {"shelf": shelf})

    def list_books(self) -> list[BookMeta]:
        rows = self._conn.execute(
            "SELECT * FROM books ORDER BY created_at DESC"
        ).fetchall()
        return [self._row_to_meta(r) for r in rows]

    def get_book(self, book_id: str) -> BookMeta | None:
        row = self._conn.execute(
            "SELECT * FROM books WHERE id = ?", (book_id,)
        ).fetchone()
        return self._row_to_meta(row) if row else None

    @staticmethod
    def _row_to_meta(row: sqlite3.Row) -> BookMeta:
        return BookMeta(
            id=row["id"],
            title=row["title"],
            source_lang=row["source_lang"],
            target_lang=row["target_lang"],
            page_count=row["page_count"],
            toc=[TocEntry(**t) for t in json.loads(row["toc_json"])],
            author=row["author"],
            shelf=row["shelf"],
            source=row["source"],
        )

    # --- blocks ---
    @staticmethod
    def _row_to_block(r: sqlite3.Row) -> Block:
        return Block(
            id=r["block_id"],
            page=r["page"],
            order=r["ord"],
            type=BlockType(r["type"]),
            text=r["text"],
            level=r["level"],
            size=r["size"],
            src=r["src"],
            bbox=tuple(json.loads(r["bbox_json"])) if r["bbox_json"] else None,
        )

    def get_page(self, book_id: str, page: int) -> list[Block]:
        rows = self._conn.execute(
            "SELECT * FROM blocks WHERE book_id = ? AND page = ? ORDER BY ord",
            (book_id, page),
        ).fetchall()
        return [self._row_to_block(r) for r in rows]

    def get_headings(self, book_id: str) -> list[Block]:
        """All heading blocks in reading order — input to TOC derivation."""
        rows = self._conn.execute(
            "SELECT * FROM blocks "
            "WHERE book_id = ? AND type = 'heading' AND text <> '' ORDER BY page, ord",
            (book_id,),
        ).fetchall()
        return [self._row_to_block(r) for r in rows]

    def body_size(self, book_id: str) -> float:
        """Median font size of paragraph blocks (the body text)."""
        rows = self._conn.execute(
            "SELECT size FROM blocks "
            "WHERE book_id = ? AND type = 'paragraph' AND size IS NOT NULL",
            (book_id,),
        ).fetchall()
        sizes = sorted(r["size"] for r in rows)
        if not sizes:
            return 12.0
        return sizes[len(sizes) // 2]

    # --- readers and their records ---
    #
    # Merging is last-write-wins on each record's own timestamp. That can lose
    # one edit made on two devices while both were offline — a page turn, or a
    # single review — which is the price of not carrying an event log around.
    # It cannot lose a record, and it cannot resurrect a deleted one.

    def list_readers(self, include_deleted: bool = False) -> list[Reader]:
        sql = "SELECT * FROM readers"
        if not include_deleted:
            sql += " WHERE deleted_at IS NULL"
        rows = self._conn.execute(sql + " ORDER BY name").fetchall()
        return [Reader(**dict(r)) for r in rows]

    def save_readers(self, readers: list[Reader]) -> list[Reader]:
        """Merge a device's view of who exists, and hand back the merged list."""
        with self._lock:
            existing = {
                r["id"]: r["updated_at"]
                for r in self._conn.execute("SELECT id, updated_at FROM readers")
            }
            for reader in readers:
                if not _newer(reader.updated_at, existing.get(reader.id)):
                    continue
                self._conn.execute(
                    "INSERT OR REPLACE INTO readers "
                    "(id, name, avatar, settings_json, updated_at, deleted_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (
                        reader.id,
                        reader.name,
                        reader.avatar,
                        reader.settings_json,
                        reader.updated_at,
                        reader.deleted_at,
                    ),
                )
            self._conn.commit()
        return self.list_readers()

    def sync(self, reader_id: str, since: str | None, incoming: SyncPayload) -> SyncPayload:
        """Merge what a device has, then return everything it has not seen.

        A record the device just sent can come straight back if the server's
        copy was newer — which is exactly what should happen.
        """
        with self._lock:
            self._merge_progress(reader_id, incoming.progress)
            self._merge_favourites(reader_id, incoming.favourites)
            self._merge_words(reader_id, incoming.words)
            self._conn.commit()
        return self._changed_since(reader_id, since)

    def _merge_progress(self, reader_id: str, items: list[ReadingProgress]) -> None:
        have = {
            r["book_id"]: r["updated_at"]
            for r in self._conn.execute(
                "SELECT book_id, updated_at FROM reading_progress WHERE reader_id = ?",
                (reader_id,),
            )
        }
        for item in items:
            if _newer(item.updated_at, have.get(item.book_id)):
                self._conn.execute(
                    "INSERT OR REPLACE INTO reading_progress "
                    "(reader_id, book_id, page, updated_at) VALUES (?,?,?,?)",
                    (reader_id, item.book_id, item.page, item.updated_at),
                )

    def _merge_favourites(self, reader_id: str, items: list[Favourite]) -> None:
        have = {
            r["book_id"]: max(filter(None, (r["created_at"], r["deleted_at"])), default=None)
            for r in self._conn.execute(
                "SELECT book_id, created_at, deleted_at FROM favourites WHERE reader_id = ?",
                (reader_id,),
            )
        }
        for item in items:
            stamp = max(filter(None, (item.created_at, item.deleted_at)), default=None)
            if _newer(stamp, have.get(item.book_id)):
                self._conn.execute(
                    "INSERT OR REPLACE INTO favourites "
                    "(reader_id, book_id, created_at, deleted_at) VALUES (?,?,?,?)",
                    (reader_id, item.book_id, item.created_at, item.deleted_at),
                )

    @staticmethod
    def _word_stamp(created: str | None, deleted: str | None, reviewed: str | None) -> str | None:
        return max(filter(None, (created, deleted, reviewed)), default=None)

    def _merge_words(self, reader_id: str, items: list[SavedWord]) -> None:
        have = {
            r["id"]: self._word_stamp(r["created_at"], r["deleted_at"], r["reviewed_at"])
            for r in self._conn.execute(
                "SELECT id, created_at, deleted_at, reviewed_at FROM saved_words "
                "WHERE reader_id = ?",
                (reader_id,),
            )
        }
        for w in items:
            stamp = self._word_stamp(w.created_at, w.deleted_at, w.reviewed_at)
            if not _newer(stamp, have.get(w.id)):
                continue
            self._conn.execute(
                "INSERT OR REPLACE INTO saved_words "
                "(id, reader_id, text, context, kind, explanation, gloss, book_id, book_title, "
                " page, created_at, deleted_at, due_at, interval_days, ease, reps, lapses, "
                " reviewed_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    w.id, reader_id, w.text, w.context, w.kind, w.explanation, w.gloss,
                    w.book_id, w.book_title, w.page, w.created_at, w.deleted_at, w.due_at,
                    w.interval_days, w.ease, w.reps, w.lapses, w.reviewed_at,
                ),
            )

    def _changed_since(self, reader_id: str, since: str | None) -> SyncPayload:
        cutoff = _at(since)

        def after(*stamps: str | None) -> bool:
            if cutoff is None:
                return True
            latest = max((d for d in map(_at, stamps) if d), default=None)
            return latest is not None and latest > cutoff

        progress = [
            ReadingProgress(book_id=r["book_id"], page=r["page"], updated_at=r["updated_at"])
            for r in self._conn.execute(
                "SELECT * FROM reading_progress WHERE reader_id = ?", (reader_id,)
            )
            if after(r["updated_at"])
        ]
        favourites = [
            Favourite(
                book_id=r["book_id"], created_at=r["created_at"], deleted_at=r["deleted_at"]
            )
            for r in self._conn.execute(
                "SELECT * FROM favourites WHERE reader_id = ?", (reader_id,)
            )
            if after(r["created_at"], r["deleted_at"])
        ]
        words = [
            SavedWord(**{k: v for k, v in dict(r).items() if k != "reader_id"})
            for r in self._conn.execute(
                "SELECT * FROM saved_words WHERE reader_id = ?", (reader_id,)
            )
            if after(r["created_at"], r["deleted_at"], r["reviewed_at"])
        ]
        return SyncPayload(progress=progress, favourites=favourites, words=words)

    # --- translations cache ---
    def get_cached(
        self, book_id: str, block_ids: list[str], model_id: str
    ) -> dict[str, TranslatedBlock]:
        if not block_ids:
            return {}
        placeholders = ",".join("?" * len(block_ids))
        rows = self._conn.execute(
            f"SELECT block_id, text, alternatives_json FROM translations "
            f"WHERE book_id = ? AND model_id = ? AND block_id IN ({placeholders})",
            (book_id, model_id, *block_ids),
        ).fetchall()
        return {
            r["block_id"]: TranslatedBlock(
                id=r["block_id"],
                text=r["text"],
                alternatives=json.loads(r["alternatives_json"]),
            )
            for r in rows
        }

    def save_translations(
        self, book_id: str, model_id: str, translated: list[TranslatedBlock]
    ) -> None:
        with self._lock:
            self._conn.executemany(
                "INSERT OR REPLACE INTO translations "
                "(book_id, block_id, model_id, text, alternatives_json) "
                "VALUES (?,?,?,?,?)",
                [
                    (
                        book_id,
                        t.id,
                        model_id,
                        t.text,
                        json.dumps(t.alternatives),
                    )
                    for t in translated
                ],
            )
            self._conn.commit()
