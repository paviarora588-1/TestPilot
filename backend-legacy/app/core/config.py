import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent

# Prefer the repo-root .env, then allow a backend-local override if present.
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env", override=False)


def _resolve_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str((BACKEND_ROOT / path).resolve())


def _resolve_project_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str((PROJECT_ROOT / path).resolve())


@dataclass(frozen=True)
class Settings:
    app_name: str = "TestPilot AI"
    app_env: str = os.getenv("APP_ENV", "local")
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_ROOT / 'testpilot.db').as_posix()}")
    ai_provider: str = os.getenv("AI_PROVIDER", "local")
    model_name: str = os.getenv("MODEL_NAME", "Qwen2.5-1.5B-Instruct-Q4_K_M")
    vector_db_type: str = os.getenv("VECTOR_DB_TYPE", "mock")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_api_base_url: str = os.getenv("GEMINI_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_api_base_url: str = os.getenv("OPENAI_API_BASE_URL", "https://api.openai.com/v1")
    local_ai_base_url: str = os.getenv("LOCAL_AI_BASE_URL", "http://127.0.0.1:11434/v1")
    local_ai_server_executable: str = field(default_factory=lambda: _resolve_project_path(os.getenv("LOCAL_AI_SERVER_EXECUTABLE", ".tools/llama.cpp/llama-server.exe")))
    local_ai_model_path: str = field(default_factory=lambda: _resolve_project_path(os.getenv("LOCAL_AI_MODEL_PATH", ".tools/models/qwen2.5-1.5b-instruct-q4_k_m.gguf")))
    local_ai_context_size: int = int(os.getenv("LOCAL_AI_CONTEXT_SIZE", "4096"))
    local_ai_threads: int = int(os.getenv("LOCAL_AI_THREADS", "8"))
    local_vision_base_url: str = os.getenv("LOCAL_VISION_BASE_URL", "http://127.0.0.1:8081/v1")
    local_vision_server_executable: str = field(default_factory=lambda: _resolve_project_path(os.getenv("LOCAL_VISION_SERVER_EXECUTABLE", ".tools/llama.cpp/llama-server.exe")))
    local_vision_model_path: str = field(default_factory=lambda: _resolve_project_path(os.getenv("LOCAL_VISION_MODEL_PATH", ".tools/models/qwen2-vl-2b-instruct-q4_k_m.gguf")))
    local_vision_mmproj_path: str = field(default_factory=lambda: _resolve_project_path(os.getenv("LOCAL_VISION_MMPROJ_PATH", ".tools/models/qwen2-vl-2b-instruct-mmproj-f16.gguf")))
    local_vision_context_size: int = int(os.getenv("LOCAL_VISION_CONTEXT_SIZE", "4096"))
    local_vision_threads: int = int(os.getenv("LOCAL_VISION_THREADS", "8"))
    ai_request_timeout_seconds: int = int(os.getenv("AI_REQUEST_TIMEOUT_SECONDS", "90"))
    ai_rate_limit_requests_per_minute: int = int(os.getenv("AI_RATE_LIMIT_REQUESTS_PER_MINUTE", "60"))
    enable_local_runner: bool = os.getenv("ENABLE_LOCAL_RUNNER", "false").lower() == "true"
    local_runner_timeout_seconds: int = int(os.getenv("LOCAL_RUNNER_TIMEOUT_SECONDS", "120"))
    upload_dir: str = field(default_factory=lambda: _resolve_path(os.getenv("UPLOAD_DIR", "app/uploads")))
    generated_script_dir: str = field(default_factory=lambda: _resolve_path(os.getenv("GENERATED_SCRIPT_DIR", "app/generated_scripts")))
    frontend_origin: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    api_auth_token: str = os.getenv("API_AUTH_TOKEN", "")
    jira_base_url: str = os.getenv("JIRA_BASE_URL", "")
    zephyr_token: str = os.getenv("ZEPHYR_TOKEN", "")

    @property
    def ai_configured(self) -> bool:
        provider = self.ai_provider.strip().lower()
        if provider == "openai":
            return bool(self.openai_api_key.strip())
        if provider in {"local", "llama_cpp", "llamacpp"}:
            # Check if the server is already reachable before requiring local files.
            try:
                import requests as _req
                resp = _req.get(self.local_ai_base_url.rsplit("/v1", 1)[0] + "/health", timeout=1.5)
                if resp.status_code == 200:
                    return True
            except Exception:
                pass
            return Path(self.local_ai_server_executable).is_file() and Path(self.local_ai_model_path).is_file()
        return False

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key.strip())

    @property
    def vision_configured(self) -> bool:
        try:
            import requests as _req
            resp = _req.get(self.local_vision_base_url.rsplit("/v1", 1)[0] + "/health", timeout=1.5)
            if resp.status_code == 200:
                return True
        except Exception:
            pass
        return (
            Path(self.local_vision_server_executable).is_file()
            and Path(self.local_vision_model_path).is_file()
            and Path(self.local_vision_mmproj_path).is_file()
        )


settings = Settings()
