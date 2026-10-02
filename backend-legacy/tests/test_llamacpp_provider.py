from app.ai.llamacpp_provider import LlamaCppProvider


class FakeResponse:
    def __init__(self, payload=None, status_code=200):
        self._payload = payload or {}
        self.status_code = status_code
        self.text = ""

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self):
        self.request = None

    def get(self, *_args, **_kwargs):
        return FakeResponse()

    def post(self, url, **kwargs):
        self.request = {"url": url, **kwargs}
        return FakeResponse(
            {
                "model": "local-test",
                "choices": [{"message": {"content": '{"status":"ok"}'}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12},
            }
        )


def test_local_provider_uses_openai_compatible_json_contract():
    session = FakeSession()
    provider = LlamaCppProvider(session=session)

    result = provider.generate_json(
        system_prompt="System",
        user_prompt="Return JSON",
        response_schema={"type": "object", "properties": {"status": {"type": "string"}}},
    )

    assert result.text == '{"status":"ok"}'
    assert result.usage and result.usage.total_tokens == 12
    assert session.request["url"].endswith("/v1/chat/completions")
    assert session.request["json"]["cache_prompt"] is True


def test_local_provider_caps_large_prompts_before_request():
    session = FakeSession()
    provider = LlamaCppProvider(session=session)

    provider.generate_json(
        system_prompt="System",
        user_prompt="x" * 30000,
        response_schema={"type": "object", "properties": {"status": {"type": "string"}}},
        max_output_tokens=5000,
    )

    request = session.request["json"]
    assert request["max_tokens"] == 2048
    assert len(request["messages"][1]["content"]) < 9000
    assert "local prompt truncated" in request["messages"][1]["content"]
