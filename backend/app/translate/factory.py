from functools import lru_cache

from app.config import get_settings
from app.translate.base import TranslationProvider
from app.translate.ollama import OllamaProvider


@lru_cache
def get_provider() -> TranslationProvider:
    """Build the configured provider. Anthropic/OpenAI are imported lazily so
    their SDKs are only required when actually selected."""
    s = get_settings()
    if s.provider == "ollama":
        return OllamaProvider(
            s.ollama_host, s.ollama_model, s.ollama_concurrency, s.ollama_timeout
        )
    if s.provider == "anthropic":
        from app.translate.anthropic import AnthropicProvider

        return AnthropicProvider(s.anthropic_api_key, s.anthropic_model)
    if s.provider == "openai":
        from app.translate.openai import OpenAIProvider

        return OpenAIProvider(s.openai_api_key, s.openai_model)
    raise ValueError(f"Unknown MIRABOOK_PROVIDER: {s.provider!r}")
