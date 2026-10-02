from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import requests

from app.ai.base import AICompletion, AIProviderError, AIUsage
from app.ai.llamacpp_provider import _error_message, _port_from_base_url, _server_ready, fit_prompt_to_context
from app.core.config import settings

MISSING_VISION_MESSAGE = (
    "Local vision AI is not installed. Run scripts/setup-local-ai.ps1 -WithVision once "
    "to download the local screenshot-analysis model; no API key or payment is required."
)

_START_LOCK = threading.Lock()
_SERVER_PROCESS: subprocess.Popen | None = None


class LlamaCppVisionProvider:
    """Zero-cost local screenshot analysis through llama.cpp's multimodal (mtmd) support.

    Runs as a second local llama-server instance (its own port) loaded with a small
    vision-capable model + mmproj projector, separate from the text-only server used
    for every other AI task in this app. This keeps screenshot analysis fully local
    without changing the model/behavior of any existing AI feature.
    """

    provider_name = "local"

    def __init__(self, *, session: requests.Session | None = None) -> None:
        self._session = session or requests.Session()
        self._base_url = settings.local_vision_base_url.rstrip("/")

    @property
    def configured(self) -> bool:
        if _server_ready(self._base_url, self._session):
            return True
        return (
            Path(settings.local_vision_server_executable).is_file()
            and Path(settings.local_vision_model_path).is_file()
            and Path(settings.local_vision_mmproj_path).is_file()
        )

    def generate_json_from_image(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        image_base64: str,
        image_mime: str = "image/png",
        response_schema: dict[str, Any] | None = None,
        max_output_tokens: int = 1800,
        temperature: float = 0.15,
    ) -> AICompletion:
        self._ensure_server()
        context_size = max(2048, int(settings.local_vision_context_size or 4096))
        capped_output_tokens = min(max_output_tokens, max(1024, context_size // 2))
        user_prompt = fit_prompt_to_context(system_prompt, user_prompt, capped_output_tokens, context_size)

        response_format: dict[str, Any] = {"type": "json_object"}
        if response_schema:
            response_format = {
                "type": "json_schema",
                "json_schema": {"name": "testpilot_vision_response", "strict": False, "schema": response_schema},
            }

        payload: dict[str, Any] = {
            "model": "vision",
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{image_base64}"}},
                    ],
                },
            ],
            "max_tokens": capped_output_tokens,
            "temperature": temperature,
            "response_format": response_format,
        }
        try:
            response = self._session.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                # Real screenshots take far longer to encode through the CPU vision tower than the
                # tiny test image this was originally tuned against — give it generous headroom.
                timeout=max(settings.ai_request_timeout_seconds, 1200),
            )
        except requests.RequestException as exc:
            raise AIProviderError(
                f"Local vision model request failed: {exc}",
                status_code=502,
                code="local_vision_request_failed",
                provider_name=self.provider_name,
                retryable=True,
            ) from exc
        if response.status_code >= 400:
            raise AIProviderError(
                _error_message(response),
                status_code=response.status_code,
                code="local_vision_http_error",
                provider_name=self.provider_name,
                retryable=response.status_code >= 500,
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise AIProviderError("Local vision model returned invalid JSON.", status_code=502, code="invalid_json", provider_name=self.provider_name) from exc
        choices = data.get("choices") or []
        content = ((choices[0].get("message") or {}).get("content") if choices else "") or ""
        if not content.strip():
            raise AIProviderError("Local vision model returned an empty response.", status_code=502, code="empty_response", provider_name=self.provider_name)
        usage = data.get("usage") or {}
        return AICompletion(
            text=content.strip(),
            model=data.get("model") or "vision",
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
            raise AIProviderError(MISSING_VISION_MESSAGE, status_code=503, code="local_vision_not_installed", provider_name=self.provider_name)
        global _SERVER_PROCESS
        with _START_LOCK:
            if _server_ready(self._base_url, self._session):
                return
            log_dir = Path(settings.local_vision_server_executable).parent
            log_dir.mkdir(parents=True, exist_ok=True)
            log_handle = (log_dir / "llama-vision-server.log").open("ab")
            creation_flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            _SERVER_PROCESS = subprocess.Popen(
                [
                    settings.local_vision_server_executable,
                    "--model", settings.local_vision_model_path,
                    "--mmproj", settings.local_vision_mmproj_path,
                    "--host", "127.0.0.1",
                    "--port", _port_from_base_url(self._base_url),
                    "--ctx-size", str(settings.local_vision_context_size),
                    "--threads", str(settings.local_vision_threads),
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
            "Local vision model server did not become ready. Check .tools/llama.cpp/llama-vision-server.log.",
            status_code=503,
            code="local_vision_start_failed",
            provider_name=self.provider_name,
        )
