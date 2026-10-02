from app.ai.openai_provider import OpenAIProvider


class FakeResponse:
    status_code = 200
    text = ""

    def json(self):
        return {
            "model": "gpt-4.1-mini",
            "choices": [{"message": {"content": '{"status":"ok"}'}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7},
        }


class FakeSession:
    def __init__(self):
        self.request = None

    def post(self, url, **kwargs):
        self.request = {"url": url, **kwargs}
        return FakeResponse()


def test_openai_provider_uses_real_chat_completions_contract():
    session = FakeSession()
    provider = OpenAIProvider(api_key="test-key", model_name="gpt-4.1-mini", session=session)

    result = provider.generate_json(
        system_prompt="System",
        user_prompt="Return JSON",
        response_schema={"type": "object", "properties": {"status": {"type": "string"}}},
    )

    assert result.text == '{"status":"ok"}'
    assert result.usage and result.usage.total_tokens == 7
    assert session.request["url"].endswith("/chat/completions")
    assert session.request["headers"]["Authorization"] == "Bearer test-key"
    assert session.request["json"]["response_format"]["type"] == "json_schema"
