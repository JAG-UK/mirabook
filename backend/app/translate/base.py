from abc import ABC, abstractmethod

from app.models import Alternative, Block, Explanation, TranslatedBlock

# Shared prompt fragments so every provider behaves consistently.
TRANSLATE_SYSTEM = (
    "You are an expert literary translator. Translate the {src} text into {tgt}. "
    "Preserve meaning, tone, register and paragraph structure. "
    "Return ONLY the translated text with no preamble, notes, or quotation marks."
)

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

    @property
    @abstractmethod
    def model_id(self) -> str: ...

    @abstractmethod
    async def translate(
        self, blocks: list[Block], src: str, tgt: str
    ) -> list[TranslatedBlock]: ...

    @abstractmethod
    async def explain(
        self, text: str, context: str, kind: str, src: str, tgt: str
    ) -> Explanation: ...

    @abstractmethod
    async def alternatives(
        self, text: str, context: str, src: str, tgt: str
    ) -> list[Alternative]: ...
