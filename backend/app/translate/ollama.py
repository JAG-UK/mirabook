import json
import re

import httpx

from app.models import Alternative, Explanation
from app.translate.base import (
    ALTERNATIVES_SYSTEM,
    EXPLAIN_GRAMMAR_SYSTEM,
    EXPLAIN_IDIOM_SYSTEM,
    PROMPT_VERSION,
    TRANSLATE_SYSTEM,
    TranslationProvider,
)


class OllamaProvider(TranslationProvider):
    """Talks to a local (or remote) Ollama server via its /api/chat endpoint."""

    name = "ollama"

    def __init__(self, host: str, model: str, concurrency: int = 4, timeout: int = 180):
        self._host = host.rstrip("/")
        self._model = model
        self.max_concurrency = concurrency  # configurable for bigger GPUs
        self._timeout = timeout

    @property
    def model_id(self) -> str:
        return f"ollama:{self._model}#p{PROMPT_VERSION}"

    def _needs_folded_system(self) -> bool:
        """True for Gemma generations that only know `user` and `model` turns.

        Gemma 1-3 (translategemma included) were not trained with a system
        role — Ollama just prepends it and the model under-weights it, so the
        instruction has to be folded into the user turn. Gemma 4 added a real
        system turn, so it takes the conventional message like every other
        family (qwen, llama, mistral, …).
        """
        name = self._model.lower()
        if "gemma" not in name:
            return False
        return not re.search(r"gemma-?[4-9]", name)

    def _messages(self, system: str, user: str) -> list[dict]:
        if self._needs_folded_system():
            return [{"role": "user", "content": f"{system}\n\n{user}"}]
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

    async def _chat(self, system: str, user: str, *, as_json: bool = False) -> str:
        payload = {
            "model": self._model,
            "messages": self._messages(system, user),
            "stream": False,
            "options": {"temperature": 0.2},
        }
        if as_json:
            payload["format"] = "json"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(f"{self._host}/api/chat", json=payload)
            r.raise_for_status()
            return r.json()["message"]["content"].strip()

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
