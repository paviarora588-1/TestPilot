from collections.abc import Iterator

from fastapi import HTTPException

from app.agents.testpilot_agent import MISSING_AI_KEY_MESSAGE, TestPilotAgent, action_checklist, compact_ai_payload, compact_mapping_object, knowledge_profile, normalize_json_text, select_relevant_context
from app.ai.base import AICompletion, AIProviderError, AIUsage, BaseAIProvider
from app.ai.schema_utils import instruction_schema_to_json_schema


class DummyProvider(BaseAIProvider):
    provider_name = "openai"

    def __init__(
        self,
        *,
        configured: bool = True,
        completion: AICompletion | None = None,
        error: AIProviderError | None = None,
    ) -> None:
        self._configured = configured
        self._completion = completion
        self._error = error

    @property
    def configured(self) -> bool:
        return self._configured

    @property
    def model_name(self) -> str:
        return "gpt-4.1-mini"

    def generate_text(self, **kwargs) -> AICompletion:
        raise NotImplementedError

    def generate_json(self, **kwargs) -> AICompletion:
        if self._error:
            raise self._error
        assert self._completion is not None
        return self._completion

    def stream_text(self, **kwargs) -> Iterator[str]:
        yield from ()


def test_agent_returns_json_with_provider_metadata():
    completion = AICompletion(
        text='{"module":"SE","quality_score":91}',
        model="gpt-4.1-mini",
        raw_response={"usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 8, "totalTokenCount": 20}},
        usage=AIUsage(prompt_tokens=12, output_tokens=8, total_tokens=20),
    )
    agent = TestPilotAgent(provider=DummyProvider(completion=completion))

    result = agent.analyze_test_case({"title": "Create function"}, ["Some guide text"])

    assert result["module"] == "SE"
    assert result["quality_score"] == 91
    assert result["ai_provider"] == "openai"
    assert result["ai_model"] == "gpt-4.1-mini"
    assert result["ai_usage"]["total_tokens"] == 20


def test_knowledge_profile_uses_full_document_headings_instead_of_cover_only():
    text = "\n".join(
        [
            "Security Weaver User Guide",
            "Warranty and Disclaimer",
            *[f"Legal opening line {index}" for index in range(80)],
            "4 Conflict Repository",
            "4.1 Maintaining Functions",
            "4.2 Maintaining Conflicts",
            "4.11 Transporting Conflict Repository Objects",
            *[f"Middle guide line {index}" for index in range(80)],
            "7 Reporting and Analysis",
            "7.1 Running Reports",
        ]
    )

    profile = knowledge_profile(text)

    assert "Conflict Repository" in profile["candidate_modules"]
    assert "Maintaining Functions" in profile["candidate_features"]
    assert "Warranty and Disclaimer" not in profile["candidate_modules"]
    assert any("Reporting and Analysis" in excerpt for excerpt in profile["representative_excerpts"])


def test_script_generation_reconstructs_code_from_json_safe_lines():
    completion = AICompletion(
        text='{"file_name":"test.vbs","code_lines":["Option Explicit","MsgBox \\"Hello\\""],"risk_score":10,"notes":[]}',
        model="gpt-4.1-mini",
        raw_response={},
    )
    agent = TestPilotAgent(provider=DummyProvider(completion=completion))

    result = agent.generate_script({"title": "Test"}, [], "SAP_GUI_VBSCRIPT")

    assert result["code"] == 'Option Explicit\nMsgBox "Hello"'
    assert "code_lines" not in result


def test_script_generation_rejects_invalid_code_lines():
    completion = AICompletion(
        text='{"file_name":"test.vbs","code_lines":"Option Explicit","risk_score":10,"notes":[]}',
        model="gpt-4.1-mini",
        raw_response={},
    )
    agent = TestPilotAgent(provider=DummyProvider(completion=completion))

    try:
        agent.generate_script({"title": "Test"}, [], "SAP_GUI_VBSCRIPT")
    except HTTPException as exc:
        assert exc.status_code == 502
        assert exc.detail == "AI provider returned invalid script code lines"
    else:  # pragma: no cover - defensive
        raise AssertionError("Expected HTTPException")


def test_agent_raises_missing_openai_key_error():
    agent = TestPilotAgent(provider=DummyProvider(configured=False))

    try:
        agent.analyze_test_case({"title": "Create function"}, [])
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == MISSING_AI_KEY_MESSAGE
    else:  # pragma: no cover - defensive
        raise AssertionError("Expected HTTPException")


def test_agent_maps_provider_errors_to_http_errors():
    provider_error = AIProviderError(
        "Rate limit exceeded.",
        status_code=429,
        code="RESOURCE_EXHAUSTED",
        provider_name="openai",
        retryable=True,
    )
    agent = TestPilotAgent(provider=DummyProvider(error=provider_error))

    try:
        agent.analyze_test_case({"title": "Create function"}, [])
    except HTTPException as exc:
        assert exc.status_code == 429
        assert "OpenAI request failed for Test case analysis" in str(exc.detail)
    else:  # pragma: no cover - defensive
        raise AssertionError("Expected HTTPException")


def test_instruction_schema_conversion_handles_nullable_and_nested_values():
    schema = instruction_schema_to_json_schema(
        {
            "status": "mapped | needs_review | unmapped",
            "mapped_object_id": "integer or null",
            "warnings": ["string"],
            "bug_draft": {
                "title": "string",
                "severity": "string",
            },
        }
    )

    assert schema["type"] == "object"
    assert schema["properties"]["status"]["enum"] == ["mapped", "needs_review", "unmapped"]
    assert schema["properties"]["mapped_object_id"]["anyOf"][1]["type"] == "null"
    assert schema["properties"]["warnings"]["type"] == "array"
    assert schema["properties"]["bug_draft"]["type"] == "object"


def test_payload_compaction_removes_metadata_and_bounds_context():
    payload = compact_ai_payload({"created_at": "now", "ai_raw_response": "huge", "content": "x" * 3000, "rows": list(range(100))})

    assert "created_at" not in payload
    assert "ai_raw_response" not in payload
    assert len(payload["content"]) < 1900
    assert len(payload["rows"]) == 32


def test_mapping_object_compaction_keeps_choice_fields_without_long_locator():
    payload = compact_mapping_object(
        {
            "id": 42,
            "object_name": "Create Function Button",
            "module": "/n/demo/start",
            "feature": "Conflict Repository",
            "screen": "SOD Version: 135 - 2026Q2 NON-ABAP Testing",
            "area_or_tab": "Functions",
            "object_type": "button",
            "technical_path": "/app/con[0]/ses[0]/wnd[0]/usr/" + ("subLONG/" * 40) + "btnCREATE",
            "supported_actions": ["click", "verify", "hotkey", "select", "extra"],
            "aliases": ["Create", "Add", "Function", "Extra"],
            "confidence": 95,
        }
    )

    assert payload["id"] == 42
    assert payload["area_or_tab"] == "Functions"
    assert "technical_path" not in payload
    assert payload["supported_actions"] == ["click", "verify", "hotkey", "select"]
    assert payload["aliases"] == ["Create", "Add", "Function"]


def test_normalize_json_text_extracts_first_object_from_local_model_chatter():
    raw = 'Here is JSON:\\n```json\\n{"mapping":{"status":"needs_review"}}\\n```\\nextra text'

    assert normalize_json_text(raw) == '{"mapping":{"status":"needs_review"}}'


def test_relevant_context_limits_chunks_and_characters():
    chunks = ["unrelated " * 200, "function creation in conflict repository " * 100, "other"]
    selected = select_relevant_context(chunks, {"title": "Create function", "feature": "Conflict Repository"})

    assert selected[0].startswith("function creation")
    assert len(selected) <= 4
    assert all(len(chunk) <= 700 for chunk in selected)


def test_action_checklist_preserves_every_compound_manual_action():
    checklist = action_checklist([{"order": 1, "instruction": "Navigate to repository, click Edit, click Create, enter ID as A1 and save"}])

    assert [item["required_action"] for item in checklist] == [
        "Navigate to repository",
        "click Edit",
        "click Create",
        "enter ID as A1 and",
        "save",
    ]


def test_action_checklist_keeps_click_target_words_together():
    checklist = action_checklist(
        [
            {"order": 1, "instruction": "Click on create button"},
            {"order": 2, "instruction": "Click on add button"},
            {"order": 3, "instruction": "Click on save button"},
        ]
    )

    assert [item["required_action"] for item in checklist] == [
        "Click on create button",
        "Click on add button",
        "Click on save button",
    ]
