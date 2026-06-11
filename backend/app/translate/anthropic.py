import json

from app.models import Alternative, Explanation
from app.translate.base import (
    ALTERNATIVES_SYSTEM,
    EXPLAIN_GRAMMAR_SYSTEM,
    EXPLAIN_IDIOM_SYSTEM,
    TRANSLATE_SYSTEM,
    TranslationProvider,
)


class AnthropicProvider(TranslationProvider):
    """High-quality path via the Anthropic API. Requires `anthropic` (install
    with `uv sync --extra anthropic`) and MIRABOOK_ANTHROPIC_API_KEY."""

    name = "anthropic"

    def __init__(self, api_key: str | None, model: str):
        try:
            import anthropic
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "anthropic SDK not installed — run `uv sync --extra anthropic`"
            ) from e
        if not api_key:
            raise RuntimeError("MIRABOOK_ANTHROPIC_API_KEY is not set")
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model

    @property
    def model_id(self) -> str:
        return f"anthropic:{self._model}"

    async def _msg(self, system: str, user: str, max_tokens: int = 1024) -> str:
        r = await self._client.messages.create(
            model=self._model,
            system=system,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in r.content if b.type == "text").strip()

    async def _translate_text(self, text: str, src: str, tgt: str) -> str:
        return await self._msg(TRANSLATE_SYSTEM.format(src=src, tgt=tgt), text)

    async def explain(
        self, text: str, context: str, kind: str, src: str, tgt: str
    ) -> Explanation:
        system = (EXPLAIN_IDIOM_SYSTEM if kind == "idiom" else EXPLAIN_GRAMMAR_SYSTEM).format(
            src=src, tgt=tgt
        )
        user = f'Highlighted phrase: "{text}"\n\nSurrounding sentence: "{context}"'
        return Explanation(kind=kind, text=await self._msg(system, user))

    async def alternatives(
        self, text: str, context: str, src: str, tgt: str
    ) -> list[Alternative]:
        system = ALTERNATIVES_SYSTEM.format(src=src, tgt=tgt)
        user = f'Highlighted phrase: "{text}"\n\nSurrounding sentence: "{context}"'
        raw = await self._msg(system, user)
        try:
            data = json.loads(raw)
            return [Alternative(**o) for o in data.get("options", [])]
        except (json.JSONDecodeError, TypeError, ValueError):
            return [Alternative(text=raw)]
