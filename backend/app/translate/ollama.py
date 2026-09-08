import json
import re

import httpx

from app.models import Alternative, Explanation
from app.translate.base import (
    ALTERNATIVES_SYSTEM,
    GLOSS_SYSTEM,
    EXPLAIN_GRAMMAR_SYSTEM,
    EXPLAIN_IDIOM_SYSTEM,
    PROMPT_VERSION,
    TRANSLATE_SYSTEM,
    TranslationProvider,
    clean_translation,
)


class ModelUnavailable(RuntimeError):
    """The configured model is not there. Actionable, so it is not a 500."""


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
            if r.status_code == 404:
                # Ollama answers 404 for a model it has not pulled. Raised as a
                # traceback this reads as a server fault; it is a one-line fix,
                # and the reader deserves to be told which one.
                raise ModelUnavailable(
                    f"Ollama at {self._host} has no model {self._model!r}. "
                    f"Pull it with `ollama pull {self._model}`, or set "
                    "MIRABOOK_OLLAMA_MODEL to one it has."
                )
            r.raise_for_status()
            return r.json()["message"]["content"].strip()

    async def installed_models(self) -> list[str]:
        """Everything this Ollama server has pulled locally."""
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{self._host}/api/tags")
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]

    async def ensure_ready(self) -> None:
        """Fail loudly, early, and with the fix — before a long batch job.

        A model that is missing or broken otherwise shows up as one opaque
        error per item, several hundred times over.
        """
        try:
            available = await self.installed_models()
        except httpx.HTTPError as e:
            raise RuntimeError(
                f"Cannot reach Ollama at {self._host} ({type(e).__name__}). "
                "Start it with `ollama serve`, or set MIRABOOK_OLLAMA_HOST."
            ) from e

        if self._model not in available and f"{self._model}:latest" not in available:
            names = sorted(available)
            listed = ", ".join(names[:8]) or "none"
            if len(names) > 8:
                listed += f", … ({len(names)} in total)"
            raise RuntimeError(
                f"Ollama at {self._host} has no model {self._model!r}.\n"
                f"  Pull it:   ollama pull {self._model}\n"
                f"  Or choose: --model <name>, or set MIRABOOK_OLLAMA_MODEL\n"
                f"  Installed: {listed}"
            )

        try:
            await self._chat("Reply with the word OK.", "Ready?")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(
                f"Ollama accepted {self._model!r} but the test request failed: "
                f"HTTP {e.response.status_code} — {e.response.text[:200]}"
            ) from e
        except httpx.HTTPError as e:
            raise RuntimeError(
                f"Ollama at {self._host} did not answer a test request "
                f"({type(e).__name__}). If the model is large, raise "
                "MIRABOOK_OLLAMA_TIMEOUT."
            ) from e

    async def _translate_text(self, text: str, src: str, tgt: str) -> str:
        return await self._chat(TRANSLATE_SYSTEM.format(src=src, tgt=tgt), text)

    async def gloss(self, text: str, context: str, src: str, tgt: str) -> str:
        system = GLOSS_SYSTEM.format(src=src, tgt=tgt)
        user = f'Highlighted phrase: "{text}"\n\nSurrounding sentence: "{context}"'
        return clean_translation(await self._chat(system, user), text)

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
