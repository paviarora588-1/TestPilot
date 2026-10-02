from __future__ import annotations

from functools import lru_cache

from app.ai.base import BaseAIProvider
from app.ai.openai_provider import OpenAIProvider
from app.ai.llamacpp_provider import LlamaCppProvider
from app.core.config import settings


@lru_cache(maxsize=1)
def get_ai_provider() -> BaseAIProvider:
    provider_name = settings.ai_provider.strip().lower()
    if provider_name == "openai":
        return OpenAIProvider()
    if provider_name in {"local", "llama_cpp", "llamacpp"}:
        return LlamaCppProvider()
    raise RuntimeError(f"Unsupported AI provider: {settings.ai_provider}")


def reset_ai_provider_cache() -> None:
    get_ai_provider.cache_clear()
