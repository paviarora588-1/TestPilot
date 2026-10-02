from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AIUsage:
    prompt_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    thoughts_tokens: int | None = None


@dataclass(frozen=True)
class AICompletion:
    text: str
    model: str
    raw_response: dict[str, Any]
    finish_reason: str | None = None
    usage: AIUsage | None = None


class AIProviderError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 502,
        code: str = "provider_error",
        provider_name: str = "ai",
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.provider_name = provider_name
        self.retryable = retryable
        self.details = details or {}


class BaseAIProvider(ABC):
    provider_name = "ai"

    @property
    @abstractmethod
    def configured(self) -> bool:
        raise NotImplementedError

    @property
    @abstractmethod
    def model_name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def generate_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> AICompletion:
        raise NotImplementedError

    @abstractmethod
    def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_schema: dict[str, Any] | None = None,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> AICompletion:
        raise NotImplementedError

    @abstractmethod
    def stream_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> Iterator[str]:
        raise NotImplementedError

    def stream_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_schema: dict[str, Any] | None = None,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> Iterator[str]:
        return self.stream_text(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        )
