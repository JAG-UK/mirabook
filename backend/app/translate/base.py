import asyncio
import re
from abc import ABC, abstractmethod

from app.models import Alternative, Block, BlockType, Explanation, TranslatedBlock

# Bump when prompts change so cached translations are recomputed (it is part of
# the per-model cache key). Avoids serving stale output from an older prompt.
PROMPT_VERSION = "2"

# Shared prompt fragments so every provider behaves consistently. Worded for
# "helpful" instruct models (gemma2, qwen, …) that otherwise add preambles or
# refuse degenerate inputs — unlike the pure translategemma model.
TRANSLATE_SYSTEM = (
    "You are a professional {src}-to-{tgt} translation engine. Translate the user's "
    "{src} text into natural, fluent {tgt}, preserving meaning, tone, register and "
    "line breaks. Keep proper nouns, names, places and numbers unchanged. "
    "Output ONLY the {tgt} translation — no preamble, no explanation, no notes, no "
    "quotation marks. If the text is already {tgt}, or is just a number/symbol/name "
    "with nothing to translate, repeat it back unchanged."
)

# Phrases that mean the model commented/refused instead of translating; if the
# output matches, we fall back to showing the source text.
_REFUSAL_RE = re.compile(
    r"please provide|i (cannot|can't|am unable|'m unable|am not able)|as an ai|"
    r"no text (was )?provid|there is no .* to translate|i need the .* text",
    re.IGNORECASE,
)
# A leading "Here is the translation:" / "Translation:" / "Sure, …:" preamble.
_PREAMBLE_RE = re.compile(
    r"^\s*(here(?:'s| is)[^:\n]*:|translation[^:\n]*:|sure[,!][^\n]*:?)\s*",
    re.IGNORECASE,
)


def clean_translation(out: str, original: str) -> str:
    """Strip preambles/wrapping quotes; fall back to the source on a refusal."""
    t = out.strip()
    t = _PREAMBLE_RE.sub("", t).strip()
    if len(t) >= 2 and t[0] in "\"'“«`" and t[-1] in "\"'”»`":
        t = t[1:-1].strip()
    if not t or _REFUSAL_RE.search(t):
        return original
    return t

EXPLAIN_GRAMMAR_SYSTEM = (
    "You are a patient {src} language tutor. The learner highlighted a phrase while "
    "reading. Explain the GRAMMAR of the highlighted phrase clearly and concisely in "
    "{tgt}: tense/mood, agreement, word order, and why it is constructed this way. "
    "Use the surrounding sentence only as context."
)

EXPLAIN_IDIOM_SYSTEM = (
    "You are a patient {src} language tutor. The learner highlighted a phrase while "
    "reading. Explain in {tgt} whether the highlighted phrase is an idiom, colloquialism "
    "or fixed expression, what it literally says vs. what it actually means, and give a "
    "natural {tgt} equivalent. If it is not idiomatic, say so briefly."
)

ALTERNATIVES_SYSTEM = (
    "You are an expert {src}->{tgt} translator. Give 2-4 distinct natural {tgt} "
    "translations of the highlighted phrase, ranging from literal to idiomatic. "
    "Respond as a JSON object: {{\"options\": [{{\"text\": \"...\", \"note\": \"register/nuance\"}}]}}."
)


class TranslationProvider(ABC):
    """Abstraction over a translation/explanation backend.

    Concrete implementations (Ollama, Anthropic, OpenAI) are selected by config
    via `translate.factory.get_provider`. `model_id` must uniquely identify the
    backend+model so it can be used as a cache key.
    """

    name: str
    # How many blocks to translate concurrently. Local models want a small
    # number; hosted APIs can take more.
    max_concurrency: int = 6

    @property
    @abstractmethod
    def model_id(self) -> str: ...

    @abstractmethod
    async def _translate_text(self, text: str, src: str, tgt: str) -> str:
        """Translate a single chunk of source text to the target language."""
        ...

    async def translate(
        self, blocks: list[Block], src: str, tgt: str
    ) -> list[TranslatedBlock]:
        """Translate many blocks concurrently (bounded), preserving order."""
        sem = asyncio.Semaphore(self.max_concurrency)

        async def run(b: Block) -> TranslatedBlock:
            if b.type == BlockType.image or not b.text.strip():
                return TranslatedBlock(id=b.id, text="")
            async with sem:
                raw = await self._translate_text(b.text, src, tgt)
            return TranslatedBlock(id=b.id, text=clean_translation(raw, b.text))

        return list(await asyncio.gather(*(run(b) for b in blocks)))

    @abstractmethod
    async def explain(
        self, text: str, context: str, kind: str, src: str, tgt: str
    ) -> Explanation: ...

    @abstractmethod
    async def alternatives(
        self, text: str, context: str, src: str, tgt: str
    ) -> list[Alternative]: ...
