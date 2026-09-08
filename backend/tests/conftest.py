"""Fixtures shared by the API tests.

The stub provider keeps every test independent of Ollama: it uppercases
instead of translating, and records what it was asked for.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.config import get_settings
from app.models import Alternative, Explanation
from app.translate.base import TranslationProvider

SAMPLE = Path(__file__).resolve().parents[2] / "sample-books" / "don-quijote-es.pdf"


class StubProvider(TranslationProvider):
    """Uppercases the source instead of calling a model, and records what it
    was asked to translate so tests can assert on cache behaviour."""

    name = "stub"

    def __init__(self, model_id: str = "stub:v1"):
        self._model_id = model_id
        self.translated: list[str] = []

    @property
    def model_id(self) -> str:
        return self._model_id

    async def _translate_text(self, text: str, src: str, tgt: str) -> str:
        self.translated.append(text)
        return text.upper()

    async def gloss(self, text, context, src, tgt) -> str:
        return f"gloss of {text}"

    async def explain(self, text, context, kind, src, tgt) -> Explanation:
        return Explanation(kind=kind, text=f"{kind} for {text!r} in {src}->{tgt}")

    async def alternatives(self, text, context, src, tgt) -> list[Alternative]:
        return [Alternative(text=text.upper(), note="literal"), Alternative(text="loose")]


@pytest.fixture
def provider(monkeypatch) -> StubProvider:
    stub = StubProvider()
    monkeypatch.setattr(routes, "get_provider", lambda: stub)
    return stub


@pytest.fixture
def client(tmp_path, monkeypatch, provider) -> TestClient:
    monkeypatch.setenv("MIRABOOK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MIRABOOK_PROVIDER", "ollama")
    monkeypatch.setenv("MIRABOOK_SOURCE_LANG", "Spanish")
    monkeypatch.setenv("MIRABOOK_TARGET_LANG", "English")
    monkeypatch.delenv("MIRABOOK_BASIC_AUTH", raising=False)
    get_settings.cache_clear()

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()


