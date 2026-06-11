import tempfile
from collections import Counter
from pathlib import Path

from app.ingest.pdf import ingest_pdf
from app.models import BlockType

SAMPLE = Path(__file__).resolve().parents[2] / "sample-books" / "don-quijote-es.pdf"


def test_ingest_sample_structure():
    media = Path(tempfile.mkdtemp())
    meta, blocks = ingest_pdf(
        SAMPLE, "test", "don-quijote-es", media, "/media/test", "Spanish", "English"
    )

    assert meta.page_count > 1
    kinds = Counter(b.type for b in blocks)
    # The sample has chapter headings, prose, and one embedded figure.
    assert kinds[BlockType.heading] >= 4
    assert kinds[BlockType.paragraph] > 20
    assert kinds[BlockType.image] >= 1

    # Image blocks are extracted to disk and referenced by URL path.
    img = next(b for b in blocks if b.type == BlockType.image)
    assert img.src and img.src.startswith("/media/test/images/")
    assert (media / "images").exists()
    assert any((media / "images").iterdir())

    # Block ids are unique and stable (alignment keys for translation).
    ids = [b.id for b in blocks]
    assert len(ids) == len(set(ids))


def test_chapter_detection_excludes_title():
    media = Path(tempfile.mkdtemp())
    meta, _ = ingest_pdf(
        SAMPLE, "test", "don-quijote-es", media, "/media/test", "Spanish", "English"
    )
    titles = [t.title for t in meta.toc]
    # Chapters are detected...
    assert sum("Capítulo" in t for t in titles) >= 3
    # ...and the book title / byline are NOT treated as chapters.
    assert not any(t.strip().lower().startswith("don quijote de la mancha") for t in titles)
    assert not any("Cervantes" in t for t in titles)
