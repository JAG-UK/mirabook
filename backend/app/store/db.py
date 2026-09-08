import json
import sqlite3
import threading
from pathlib import Path

from app.models import Block, BlockType, BookMeta, TocEntry, TranslatedBlock

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
