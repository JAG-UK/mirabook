from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven configuration. All vars use the MIRABOOK_ prefix."""

    model_config = SettingsConfigDict(
        env_prefix="MIRABOOK_", env_file=".env", extra="ignore"
    )

    provider: str = "ollama"  # ollama | anthropic | openai
    source_lang: str = "Spanish"
    target_lang: str = "English"

    data_dir: str = "./data"

    # Ollama
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "translategemma:4b"

    # Anthropic (only used when provider == "anthropic")
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-8"

    # OpenAI (only used when provider == "openai")
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o"


@lru_cache
def get_settings() -> Settings:
    return Settings()
