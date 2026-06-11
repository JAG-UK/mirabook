import json

import httpx

from app.models import Alternative, Block, BlockType, Explanation, TranslatedBlock
from app.translate.base import (
    ALTERNATIVES_SYSTEM,
    EXPLAIN_GRAMMAR_SYSTEM,
    EXPLAIN_IDIOM_SYSTEM,
    TRANSLATE_SYSTEM,
    TranslationProvider,
)


class OllamaProvider(TranslationProvider):
    """Talks to a local (or remote) Ollama server via its /api/chat endpoint."""

    name = "ollama"

    def __init__(self, host: str, model: str):
        self._host = host.rstrip("/")
        self._model = model

    @property
    def model_id(self) -> str:
        return f"ollama:{self._model}"

    async def _chat(self, system: str, user: str, *, as_json: bool = False) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {"temperature": 0.2},
        }
        if as_json:
            payload["format"] = "json"
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{self._host}/api/chat", json=payload)
            r.raise_for_status()
            return r.json()["message"]["content"].strip()

    async def translate(
        self, blocks: list[Block], src: str, tgt: str
    ) -> list[TranslatedBlock]:
        system = TRANSLATE_SYSTEM.format(src=src, tgt=tgt)
        out: list[TranslatedBlock] = []
        for b in blocks:
            if b.type == BlockType.image or not b.text.strip():
                out.append(TranslatedBlock(id=b.id, text=""))
                continue
            text = await self._chat(system, b.text)
            out.append(TranslatedBlock(id=b.id, text=text))
        return out

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
