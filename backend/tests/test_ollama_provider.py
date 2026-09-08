"""Tests for how the Ollama provider shapes its request.

The interesting part is the per-family system-prompt handling: getting it wrong
does not raise, it just quietly produces worse translations.
"""

import httpx
import pytest

from app.translate.ollama import OllamaProvider


def provider(model: str) -> OllamaProvider:
    return OllamaProvider("http://localhost:11434", model)


def test_model_id_identifies_backend_model_and_prompt_version():
    assert provider("gemma4:31b").model_id.startswith("ollama:gemma4:31b#p")


@pytest.mark.parametrize(
    "model",
    [
        "gemma:7b",
        "gemma2:27b",
        "gemma3:27b",
        "translategemma:4b",
        "translategemma:12b",
        "translategemma:27b",
    ],
)
def test_legacy_gemma_gets_the_system_prompt_folded_into_the_user_turn(model):
    """Gemma 1-3 only know `user` and `model` turns."""
    messages = provider(model)._messages("SYSTEM", "USER")
    assert messages == [{"role": "user", "content": "SYSTEM\n\nUSER"}]


@pytest.mark.parametrize("model", ["gemma4:31b", "gemma4:26b", "gemma-4-12b", "gemma4:e4b"])
def test_gemma4_uses_its_native_system_turn(model):
    """Gemma 4 added a real system turn — folding would waste it."""
    messages = provider(model)._messages("SYSTEM", "USER")
    assert messages == [
        {"role": "system", "content": "SYSTEM"},
        {"role": "user", "content": "USER"},
    ]


@pytest.mark.parametrize("model", ["qwen3.5:9b", "llama3.1:70b", "mistral-small", "phi4-mini:3.8b"])
def test_other_families_keep_the_conventional_system_message(model):
    messages = provider(model)._messages("SYSTEM", "USER")
    assert messages[0] == {"role": "system", "content": "SYSTEM"}
    assert messages[1] == {"role": "user", "content": "USER"}


def test_model_name_matching_is_case_insensitive():
    assert provider("Gemma2:27B")._needs_folded_system() is True
    assert provider("Gemma4:31B")._needs_folded_system() is False


# --- preflight ---
#
# A batch job must fail on its first second, with the fix, rather than
# producing one opaque error per item several hundred times over.


class FakeResponse:
    def __init__(self, payload=None, status=200, text=""):
        self._payload = payload or {}
        self.status_code = status
        self.text = text

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=self)


def fake_tags(monkeypatch, models, chat=None):
    """Stub Ollama's /api/tags, and optionally the chat probe."""

    async def installed(self):
        return models

    monkeypatch.setattr(OllamaProvider, "installed_models", installed)
    if chat is not None:
        monkeypatch.setattr(OllamaProvider, "_chat", chat)
    else:

        async def ok(self, system, user, *, as_json=False):
            return "OK"

        monkeypatch.setattr(OllamaProvider, "_chat", ok)


async def test_ensure_ready_passes_for_an_installed_model(monkeypatch):
    fake_tags(monkeypatch, ["gemma4:31b", "translategemma:4b"])
    await provider("gemma4:31b").ensure_ready()


async def test_ensure_ready_accepts_the_implicit_latest_tag(monkeypatch):
    fake_tags(monkeypatch, ["gemma4:latest"])
    await provider("gemma4").ensure_ready()


async def test_ensure_ready_names_the_missing_model_and_how_to_get_it(monkeypatch):
    fake_tags(monkeypatch, ["gemma2:27b", "qwen3.5:9b"])
    with pytest.raises(RuntimeError) as e:
        await provider("translategemma:4b").ensure_ready()
    message = str(e.value)
    assert "translategemma:4b" in message
    assert "ollama pull translategemma:4b" in message
    assert "gemma2:27b" in message  # what is actually there


async def test_ensure_ready_reports_the_servers_own_error_text(monkeypatch):
    """An HTTP status alone says nothing; the body is the actionable part."""

    async def failing(self, system, user, *, as_json=False):
        raise httpx.HTTPStatusError(
            "boom", request=None, response=FakeResponse(status=400, text="context length exceeded")
        )

    fake_tags(monkeypatch, ["gemma4:31b"], chat=failing)
    with pytest.raises(RuntimeError) as e:
        await provider("gemma4:31b").ensure_ready()
    assert "400" in str(e.value)
    assert "context length exceeded" in str(e.value)


async def test_ensure_ready_explains_an_unreachable_server(monkeypatch):
    async def unreachable(self):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(OllamaProvider, "installed_models", unreachable)
    with pytest.raises(RuntimeError) as e:
        await provider("gemma4:31b").ensure_ready()
    assert "ollama serve" in str(e.value)


async def test_ensure_ready_suggests_raising_the_timeout(monkeypatch):
    async def slow(self, system, user, *, as_json=False):
        raise httpx.ReadTimeout("too slow")

    fake_tags(monkeypatch, ["gemma4:31b"], chat=slow)
    with pytest.raises(RuntimeError) as e:
        await provider("gemma4:31b").ensure_ready()
    assert "MIRABOOK_OLLAMA_TIMEOUT" in str(e.value)


def test_concurrency_and_timeout_are_configurable():
    p = OllamaProvider("http://gpu-box:11434/", "gemma4:31b", concurrency=8, timeout=600)
    assert p.max_concurrency == 8
    assert p._timeout == 600
    assert p._host == "http://gpu-box:11434"  # trailing slash trimmed
