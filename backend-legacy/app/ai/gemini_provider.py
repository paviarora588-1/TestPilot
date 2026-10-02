from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import requests

from app.ai.base import AICompletion, AIProviderError, AIUsage, BaseAIProvider
from app.ai.rate_limit import SlidingWindowRateLimiter
from app.core.config import settings


class GeminiProvider(BaseAIProvider):
    provider_name = "gemini"

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
        self._api_key = (api_key if api_key is not None else settings.gemini_api_key).strip()
        self._model_name = model_name or settings.model_name
        self._base_url = (base_url or settings.gemini_api_base_url).rstrip("/")
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

    def generate_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> AICompletion:
        payload = self._build_payload(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
            response_mime_type="text/plain",
        )
        data = self._request_json("generateContent", payload)
        return self._parse_completion(data)

    def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_schema: dict[str, Any] | None = None,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> AICompletion:
        payload = self._build_payload(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=response_schema,
        )
        data = self._request_json("generateContent", payload)
        return self._parse_completion(data)

    def stream_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> Iterator[str]:
        payload = self._build_payload(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
            response_mime_type="text/plain",
        )
        yield from self._stream("streamGenerateContent?alt=sse", payload)

    def stream_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_schema: dict[str, Any] | None = None,
        max_output_tokens: int = 3000,
        temperature: float = 0.1,
    ) -> Iterator[str]:
        payload = self._build_payload(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=response_schema,
        )
        yield from self._stream("streamGenerateContent?alt=sse", payload)

    def _build_payload(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        max_output_tokens: int,
        temperature: float,
        response_mime_type: str,
        response_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
            "responseMimeType": response_mime_type,
        }
        if response_schema:
            generation_config["responseJsonSchema"] = response_schema

        payload: dict[str, Any] = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_prompt}],
                }
            ],
            "generationConfig": generation_config,
        }
        if system_prompt.strip():
            payload["systemInstruction"] = {
                "role": "system",
                "parts": [{"text": system_prompt}],
            }
        return payload

    def _request_json(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._enforce_rate_limit()
        url = f"{self._base_url}/models/{self._model_name}:{action}"
        try:
            response = self._session.post(
                url,
                headers=self._headers(),
                json=payload,
                timeout=self._timeout_seconds,
            )
        except requests.Timeout as exc:
            raise AIProviderError(
                "Connection timed out.",
                status_code=504,
                code="timeout",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc
        except requests.ConnectionError as exc:
            raise AIProviderError(
                "Connection error.",
                status_code=502,
                code="connection_error",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc
        except requests.RequestException as exc:
            raise AIProviderError(
                f"Request failed: {exc}",
                status_code=502,
                code="request_error",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc

        if response.status_code >= 400:
            raise self._response_error(response)

        try:
            return response.json()
        except ValueError as exc:
            raise AIProviderError(
                "Gemini returned invalid JSON.",
                status_code=502,
                code="invalid_provider_json",
                provider_name=self.provider_name,
            ) from exc

    def _stream(self, action: str, payload: dict[str, Any]) -> Iterator[str]:
        self._enforce_rate_limit()
        url = f"{self._base_url}/models/{self._model_name}:{action}"
        try:
            with self._session.post(
                url,
                headers=self._headers(),
                json=payload,
                timeout=self._timeout_seconds,
                stream=True,
            ) as response:
                if response.status_code >= 400:
                    raise self._response_error(response)
                for raw_line in response.iter_lines(decode_unicode=True):
                    if not raw_line:
                        continue
                    line = raw_line.strip()
                    if not line.startswith("data:"):
                        continue
                    event_data = line[5:].strip()
                    if not event_data or event_data == "[DONE]":
                        continue
                    try:
                        payload = json.loads(event_data)
                    except ValueError:
                        continue
                    text = self._extract_text(payload)
                    if text:
                        yield text
        except AIProviderError:
            raise
        except requests.Timeout as exc:
            raise AIProviderError(
                "Connection timed out.",
                status_code=504,
                code="timeout",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc
        except requests.ConnectionError as exc:
            raise AIProviderError(
                "Connection error.",
                status_code=502,
                code="connection_error",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc
        except requests.RequestException as exc:
            raise AIProviderError(
                f"Streaming request failed: {exc}",
                status_code=502,
                code="stream_error",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc

    def _parse_completion(self, payload: dict[str, Any]) -> AICompletion:
        blocked_reason = (payload.get("promptFeedback") or {}).get("blockReason")
        if blocked_reason and not payload.get("candidates"):
            raise AIProviderError(
                f"Prompt blocked: {blocked_reason}",
                status_code=400,
                code="prompt_blocked",
                provider_name=self.provider_name,
            )

        text = self._extract_text(payload)
        candidate = ((payload.get("candidates") or [{}])[:1] or [{}])[0]
        usage = payload.get("usageMetadata") or {}
        usage_info = AIUsage(
            prompt_tokens=usage.get("promptTokenCount"),
            output_tokens=usage.get("candidatesTokenCount"),
            total_tokens=usage.get("totalTokenCount"),
            thoughts_tokens=usage.get("thoughtsTokenCount"),
        )
        return AICompletion(
            text=text,
            model=payload.get("modelVersion") or self._model_name,
            raw_response=payload,
            finish_reason=candidate.get("finishReason"),
            usage=usage_info,
        )

    def _extract_text(self, payload: dict[str, Any]) -> str:
        texts: list[str] = []
        for candidate in payload.get("candidates") or []:
            parts = ((candidate.get("content") or {}).get("parts") or [])
            for part in parts:
                text = part.get("text")
                if text:
                    texts.append(text)
        return "".join(texts).strip()

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "x-goog-api-key": self._api_key,
        }

    def _enforce_rate_limit(self) -> None:
        retry_after = self._rate_limiter.acquire()
        if retry_after <= 0:
            return
        raise AIProviderError(
            f"Rate limit exceeded. Retry after about {int(retry_after)} seconds.",
            status_code=429,
            code="local_rate_limit_exceeded",
            provider_name=self.provider_name,
            retryable=True,
            details={"retry_after_seconds": int(retry_after)},
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
            code = str(error.get("status") or error.get("code") or code)

        retryable = response.status_code in {408, 429, 500, 502, 503, 504}
        return AIProviderError(
            message or f"HTTP {response.status_code}",
            status_code=response.status_code,
            code=code,
            provider_name=self.provider_name,
            retryable=retryable,
            details=details,
        )
