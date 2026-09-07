"""Tests for the request the Anthropic provider builds.

The `anthropic` SDK is an optional extra and is usually not installed, so these
build the provider without running its `__init__` (which imports the SDK) and
inject a fake client. That keeps the request shape — the part that silently
breaks translations when it is wrong — under test either way.
"""

from types import SimpleNamespace

import pytest

from app.translate.anthropic import AnthropicProvider


class FakeMessages:
    def __init__(self):
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            content=[
                SimpleNamespace(type="thinking", thinking="…"),
                SimpleNamespace(type="text", text="  In a place  "),
            ]
        )


@pytest.fixture
def provider() -> AnthropicProvider:
    p = object.__new__(AnthropicProvider)  # bypass the SDK import in __init__
    p._model = "claude-opus-5"
    p._client = SimpleNamespace(messages=FakeMessages())
    return p


def test_model_id_carries_the_model_and_prompt_version(provider: AnthropicProvider):
    assert provider.model_id.startswith("anthropic:claude-opus-5#p")


async def test_translate_sends_low_effort_and_a_workable_token_budget(provider: AnthropicProvider):
    """Current models think by default and thinking counts against max_tokens,
    so a translation must not be squeezed out by reasoning."""
    await provider._translate_text("En un lugar", "Spanish", "English")

    (call,) = provider._client.messages.calls
    assert call["model"] == "claude-opus-5"
    assert call["output_config"] == {"effort": "low"}
    assert call["max_tokens"] >= 4096
    assert call["messages"] == [{"role": "user", "content": "En un lugar"}]
    assert "Spanish" in call["system"] and "English" in call["system"]


async def test_only_text_blocks_are_returned(provider: AnthropicProvider):
    """Thinking blocks share the content list and must not leak into the page."""
    assert await provider._translate_text("En un lugar", "Spanish", "English") == "In a place"


async def test_explain_selects_the_prompt_for_the_kind(provider: AnthropicProvider):
    args = ("se lo dije", "Ya se lo dije.")
    grammar = await provider.explain(*args, "grammar", "Spanish", "English")
    idiom = await provider.explain(*args, "idiom", "Spanish", "English")

    assert grammar.kind == "grammar"
    assert idiom.kind == "idiom"
    grammar_call, idiom_call = provider._client.messages.calls
    assert "GRAMMAR" in grammar_call["system"]
    assert "idiom" in idiom_call["system"]


async def test_alternatives_parses_the_json_object(provider: AnthropicProvider):
    provider._client.messages.create = _returning(
        '{"options": [{"text": "In a place", "note": "literal"}, {"text": "Somewhere"}]}'
    )
    alts = await provider.alternatives("En un lugar", "", "Spanish", "English")

    assert [a.text for a in alts] == ["In a place", "Somewhere"]
    assert alts[0].note == "literal"
    assert alts[1].note is None


async def test_alternatives_falls_back_to_raw_text_when_the_reply_is_not_json(
    provider: AnthropicProvider,
):
    provider._client.messages.create = _returning("In a place, or thereabouts")
    alts = await provider.alternatives("En un lugar", "", "Spanish", "English")

    assert [a.text for a in alts] == ["In a place, or thereabouts"]


def _returning(text: str):
    async def create(**kwargs):
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])

    return create
