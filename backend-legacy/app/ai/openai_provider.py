from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import requests

from app.ai.base import AICompletion, AIProviderError, AIUsage, BaseAIProvider
from app.ai.rate_limit import SlidingWindowRateLimiter
from app.core.config import settings


class OpenAIProvider(BaseAIProvider):
    provider_name = "openai"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model_name: str | None = None,
        base_url: str | None = None,
        timeout_seconds: int | None = None,
        session: requests.Session | None = None,
        rate_limiter: SlidingWindowRateLimiter | None = None,
    ) -> None:
        self._api_key = (api_key if api_key is not None else settings.openai_api_key).strip()
        self._model_name = model_name or settings.model_name
        self._base_url = (base_url or settings.openai_api_base_url).rstrip("/")
        self._timeout_seconds = timeout_seconds or settings.ai_request_timeout_seconds
        self._session = session or requests.Session()
        self._rate_limiter = rate_limiter or SlidingWindowRateLimiter(
            settings.ai_rate_limit_requests_per_minute,
            window_seconds=60,
        )

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    @property
    def model_name(self) -> str:
        return self._model_name

    def generate_text(self, *, system_prompt: str, user_prompt: str, max_output_tokens: int = 3000, temperature: float = 0.1) -> AICompletion:
        return self._complete(system_prompt, user_prompt, max_output_tokens, temperature)

    def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_schema: dict[str, Any] | None = None,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> AICompletion:
        response_format: dict[str, Any] = {"type": "json_object"}
        if response_schema:
            response_format = {
                "type": "json_schema",
                "json_schema": {
                    "name": "testpilot_response",
                    "strict": False,
                    "schema": response_schema,
                },
            }
        return self._complete(system_prompt, user_prompt, max_output_tokens, temperature, response_format)

    def stream_text(self, *, system_prompt: str, user_prompt: str, max_output_tokens: int = 3000, temperature: float = 0.1) -> Iterator[str]:
        # Streaming is deliberately exposed through the same real provider call;
        # callers still receive a deterministic complete chunk if SSE is not needed.
        completion = self.generate_text(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        )
        if completion.text:
            yield completion.text

    def _complete(
        self,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int,
        temperature: float,
        response_format: dict[str, Any] | None = None,
    ) -> AICompletion:
        retry_after = self._rate_limiter.acquire()
        if retry_after > 0:
            raise AIProviderError(
                f"Rate limit exceeded. Retry after about {int(retry_after)} seconds.",
                status_code=429,
                code="local_rate_limit_exceeded",
                provider_name=self.provider_name,
                retryable=True,
            )

        payload: dict[str, Any] = {
            "model": self._model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_output_tokens,
            "temperature": temperature,
        }
        if response_format:
            payload["response_format"] = response_format

        try:
            response = self._session.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=self._timeout_seconds,
            )
        except requests.Timeout as exc:
            raise AIProviderError("Connection timed out.", status_code=504, code="timeout", provider_name=self.provider_name, retryable=True) from exc
        except requests.ConnectionError as exc:
            raise AIProviderError("Connection error.", status_code=502, code="connection_error", provider_name=self.provider_name, retryable=True) from exc
        except requests.RequestException as exc:
            raise AIProviderError(f"Request failed: {exc}", status_code=502, code="request_error", provider_name=self.provider_name, retryable=True) from exc

        if response.status_code >= 400:
            raise self._response_error(response)
        try:
            data = response.json()
        except ValueError as exc:
            raise AIProviderError("OpenAI returned invalid JSON.", status_code=502, code="invalid_provider_json", provider_name=self.provider_name) from exc

        choices = data.get("choices") or []
        if not choices:
            raise AIProviderError("OpenAI returned no completion choices.", status_code=502, code="empty_response", provider_name=self.provider_name)
        choice = choices[0]
        content = (choice.get("message") or {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise AIProviderError("OpenAI returned an empty completion.", status_code=502, code="empty_response", provider_name=self.provider_name)
        usage = data.get("usage") or {}
        return AICompletion(
            text=content.strip(),
            model=data.get("model") or self._model_name,
            raw_response=data,
            finish_reason=choice.get("finish_reason"),
            usage=AIUsage(
                prompt_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
                total_tokens=usage.get("total_tokens"),
            ),
        )

    def _response_error(self, response: requests.Response) -> AIProviderError:
        message = response.text.strip()
        code = "http_error"
        details: dict[str, Any] = {}
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            details = payload
            error = payload.get("error") or {}
            message = str(error.get("message") or message)
            code = str(error.get("code") or error.get("type") or code)
        return AIProviderError(
            message or f"HTTP {response.status_code}",
            status_code=response.status_code,
            code=code,
            provider_name=self.provider_name,
            retryable=response.status_code in {408, 429, 500, 502, 503, 504},
            details=details,
        )
