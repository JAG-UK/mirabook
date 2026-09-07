"""Tests for how the Ollama provider shapes its request.

The interesting part is the per-family system-prompt handling: getting it wrong
does not raise, it just quietly produces worse translations.
"""

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


def test_concurrency_and_timeout_are_configurable():
    p = OllamaProvider("http://gpu-box:11434/", "gemma4:31b", concurrency=8, timeout=600)
    assert p.max_concurrency == 8
    assert p._timeout == 600
    assert p._host == "http://gpu-box:11434"  # trailing slash trimmed
