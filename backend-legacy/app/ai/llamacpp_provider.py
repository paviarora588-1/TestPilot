from __future__ import annotations

import subprocess
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import requests

from app.ai.base import AICompletion, AIProviderError, AIUsage, BaseAIProvider
from app.core.config import settings


_START_LOCK = threading.Lock()
_SERVER_PROCESS: subprocess.Popen | None = None


class LlamaCppProvider(BaseAIProvider):
    """Zero-cost local inference through llama.cpp's OpenAI-compatible API."""

    provider_name = "local"

    def __init__(self, *, session: requests.Session | None = None) -> None:
        self._session = session or requests.Session()
        self._base_url = settings.local_ai_base_url.rstrip("/")
        self._model_name = settings.model_name

    @property
    def configured(self) -> bool:
        # An already-running server (LM Studio, Ollama, external llama.cpp, …)
        # makes the file-existence check irrelevant — we can use it directly.
        if _server_ready(self._base_url, self._session):
            return True
        return Path(settings.local_ai_server_executable).is_file() and Path(settings.local_ai_model_path).is_file()

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
                "json_schema": {"name": "testpilot_response", "strict": False, "schema": response_schema},
            }
        return self._complete(system_prompt, user_prompt, max_output_tokens, temperature, response_format)

    def stream_text(self, *, system_prompt: str, user_prompt: str, max_output_tokens: int = 3000, temperature: float = 0.1) -> Iterator[str]:
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
        self._ensure_server()
        # Keep local responses bounded; large outputs make small CPU models drift and
        # leave too little room for the grounded prompt.
        context_size = max(2048, int(settings.local_ai_context_size or 4096))
        capped_output_tokens = min(max_output_tokens, max(1024, context_size // 2))
        user_prompt = _fit_prompt_to_local_context(system_prompt, user_prompt, capped_output_tokens)
        payload: dict[str, Any] = {
            "model": self._model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": capped_output_tokens,
            "temperature": temperature,
            "cache_prompt": True,
        }
        if response_format:
            payload["response_format"] = response_format
        try:
            response = self._session.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                # Large local generations (test suites, scripts) can need thousands of tokens; at the
                # observed ~6-12 tok/s CPU speed here, a 4500-5000 token generation alone can take
                # 10+ minutes, on top of prompt processing time.
                timeout=max(settings.ai_request_timeout_seconds, 1200),
            )
        except requests.RequestException as exc:
            raise AIProviderError(
                f"Local model request failed: {exc}",
                status_code=502,
                code="local_request_failed",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc
        if response.status_code >= 400:
            raise AIProviderError(
                _error_message(response),
                status_code=response.status_code,
                code="local_http_error",
                provider_name=self.provider_name,
                retryable=response.status_code >= 500,
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise AIProviderError("Local model returned invalid JSON.", status_code=502, code="invalid_json", provider_name=self.provider_name) from exc
        choices = data.get("choices") or []
        content = ((choices[0].get("message") or {}).get("content") if choices else "") or ""
        if not content.strip():
            raise AIProviderError("Local model returned an empty response.", status_code=502, code="empty_response", provider_name=self.provider_name)
        usage = data.get("usage") or {}
        return AICompletion(
            text=content.strip(),
            model=data.get("model") or self._model_name,
            raw_response=data,
            finish_reason=choices[0].get("finish_reason") if choices else None,
            usage=AIUsage(
                prompt_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
                total_tokens=usage.get("total_tokens"),
            ),
        )

    def _ensure_server(self) -> None:
        if _server_ready(self._base_url, self._session):
            return
        if not self.configured:
            raise AIProviderError(
                "Local AI files are missing. Run scripts/setup-local-ai.ps1 once.",
                status_code=503,
                code="local_ai_not_installed",
                provider_name=self.provider_name,
            )
        global _SERVER_PROCESS
        with _START_LOCK:
            if _server_ready(self._base_url, self._session):
                return
            log_dir = Path(settings.local_ai_server_executable).parent
            log_dir.mkdir(parents=True, exist_ok=True)
            log_handle = (log_dir / "llama-server.log").open("ab")
            creation_flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            _SERVER_PROCESS = subprocess.Popen(
                [
                    settings.local_ai_server_executable,
                    "--model", settings.local_ai_model_path,
                    "--host", "127.0.0.1",
                    "--port", _port_from_base_url(self._base_url),
                    "--ctx-size", str(settings.local_ai_context_size),
                    "--threads", str(settings.local_ai_threads),
                    "--n-gpu-layers", "0",
                    "--jinja",
                ],
                cwd=log_dir,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags,
            )
            for _ in range(90):
                if _server_ready(self._base_url, self._session):
                    return
                if _SERVER_PROCESS.poll() is not None:
                    break
                time.sleep(1)
        raise AIProviderError(
            "Local model server did not become ready. Check .tools/llama.cpp/llama-server.log.",
            status_code=503,
            code="local_ai_start_failed",
            provider_name=self.provider_name,
        )


def _server_ready(base_url: str, session: requests.Session) -> bool:
    try:
        response = session.get(base_url.rsplit("/v1", 1)[0] + "/health", timeout=1.5)
        return response.status_code == 200
    except requests.RequestException:
        return False


def _port_from_base_url(base_url: str) -> str:
    from urllib.parse import urlparse

    return str(urlparse(base_url).port or 11434)


def _fit_prompt_to_local_context(system_prompt: str, user_prompt: str, max_output_tokens: int) -> str:
    return fit_prompt_to_context(system_prompt, user_prompt, max_output_tokens, settings.local_ai_context_size)


def fit_prompt_to_context(system_prompt: str, user_prompt: str, max_output_tokens: int, context_size: int) -> str:
    """Trim user prompt to stay within a local model's context window.

    Uses a 4 chars/token heuristic. Truncation respects natural boundaries in
    priority order: JSON object boundary → paragraph → sentence → word → char.
    This prevents the model from receiving a half-formed JSON instruction.
    """
    context_tokens  = max(2048, int(context_size or 4096))
    system_chars    = len(system_prompt or "") + 256   # +256 for chat template overhead
    reserved_tokens = max_output_tokens + 512
    available_chars = max(1500, (context_tokens - reserved_tokens) * 4 - system_chars)

    prompt = user_prompt or ""
    if len(prompt) <= available_chars:
        return prompt

    marker    = "\n...[local prompt truncated]..."
    keep_goal = max(1200, available_chars - len(marker))

    # Try to break at a JSON object boundary (closing brace + comma/newline)
    cut = _rfind_boundary(prompt, keep_goal, ["\n},", "\n},\n", "},\n", "},"])
    if cut < 0:
        # Fall back to paragraph break
        cut = _rfind_boundary(prompt, keep_goal, ["\n\n"])
    if cut < 0:
        # Fall back to sentence end
        cut = _rfind_boundary(prompt, keep_goal, [". ", ".\n"])
    if cut < 0:
        # Fall back to word boundary
        cut = prompt.rfind(" ", 0, keep_goal)
    if cut < 0:
        cut = keep_goal

    return prompt[:cut] + marker


def _rfind_boundary(text: str, before: int, markers: list[str]) -> int:
    """Return the last position of any marker that appears before `before`."""
    best = -1
    for marker in markers:
        pos = text.rfind(marker, 0, before)
        if pos > best:
            best = pos + len(marker)
    return best


def _error_message(response: requests.Response) -> str:
    try:
        payload = response.json()
        return str((payload.get("error") or {}).get("message") or response.text or f"HTTP {response.status_code}")
    except ValueError:
        return response.text.strip() or f"HTTP {response.status_code}"
