import json

from app.models import Alternative, Explanation
from app.translate.base import (
    ALTERNATIVES_SYSTEM,
    EXPLAIN_GRAMMAR_SYSTEM,
    EXPLAIN_IDIOM_SYSTEM,
    PROMPT_VERSION,
    TRANSLATE_SYSTEM,
    TranslationProvider,
)


class OpenAIProvider(TranslationProvider):
    """High-quality path via the OpenAI API. Requires `openai` (install with
    `uv sync --extra openai`) and MIRABOOK_OPENAI_API_KEY."""

    name = "openai"

    def __init__(self, api_key: str | None, model: str):
        try:
            from openai import AsyncOpenAI
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "openai SDK not installed — run `uv sync --extra openai`"
            ) from e
        if not api_key:
            raise RuntimeError("MIRABOOK_OPENAI_API_KEY is not set")
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    @property
    def model_id(self) -> str:
        return f"openai:{self._model}#p{PROMPT_VERSION}"

    async def _chat(self, system: str, user: str, *, as_json: bool = False) -> str:
        r = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"} if as_json else {"type": "text"},
        )
        return (r.choices[0].message.content or "").strip()

    async def _translate_text(self, text: str, src: str, tgt: str) -> str:
        return await self._chat(TRANSLATE_SYSTEM.format(src=src, tgt=tgt), text)

    async def explain(
        self, text: str, context: str, kind: str, src: str, tgt: str
    ) -> Explanation:
        system = (EXPLAIN_IDIOM_SYSTEM if kind == "idiom" else EXPLAIN_GRAMMAR_SYSTEM).format(
            src=src, tgt=tgt
        )
        user = f'Highlighted phrase: "{text}"\n\nSurrounding sentence: "{context}"'
        return Explanation(kind=kind, text=await self._chat(system, user))

    async def alternatives(
        self, text: str, context: str, src: str, tgt: str
    ) -> list[Alternative]:
        system = ALTERNATIVES_SYSTEM.format(src=src, tgt=tgt)
        user = f'Highlighted phrase: "{text}"\n\nSurrounding sentence: "{context}"'
        raw = await self._chat(system, user, as_json=True)
        try:
            data = json.loads(raw)
            return [Alternative(**o) for o in data.get("options", [])]
        except (json.JSONDecodeError, TypeError, ValueError):
            return [Alternative(text=raw)]
