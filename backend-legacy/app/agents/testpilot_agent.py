import json
import re
from dataclasses import asdict
from typing import Any

from fastapi import HTTPException

from app.ai import AIProviderError, BaseAIProvider, get_ai_provider
from app.ai.prompt_templates import TESTPILOT_SYSTEM_PROMPT, build_task_prompt
from app.ai.schema_utils import instruction_schema_to_json_schema

MISSING_AI_KEY_MESSAGE = "OPENAI_API_KEY is missing. Real AI mode requires a valid OpenAI API key."
MISSING_LOCAL_AI_MESSAGE = "Local AI is not installed. Run scripts/setup-local-ai.ps1 once; no API key or payment is required."


class TestPilotAgent:
    """TestPilot AI agent — provider-agnostic, knowledge-grounded test automation."""

    def __init__(self, provider: BaseAIProvider | None = None) -> None:
        self.provider = provider or get_ai_provider()

    # ------------------------------------------------------------------ #
    #  Knowledge                                                           #
    # ------------------------------------------------------------------ #

    def process_knowledge(self, product_id: int, extracted_text: str) -> dict[str, Any]:
        profile = knowledge_profile(extracted_text)
        return self._json_call(
            "Knowledge extraction",
            {
                "product_id": product_id,
                "document_profile": profile,
                "instructions": (
                    "Analyse the full document profile and extract ALL product-specific knowledge. "
                    "For modules_detected: identify the main functional areas, transactions, or screens of the application (e.g. 'Conflict Repository', 'User Administration', 'Report Viewer'). "
                    "For features_detected: extract specific capabilities within each module (e.g. 'Create Conflict', 'Export to Excel', 'Simulate Transport'). "
                    "For business_rules: extract validation constraints and business logic (e.g. 'Document number must be 10 digits', 'Posting date cannot be in the past'). "
                    "For validations: extract field-level or form-level checks the application enforces. "
                    "For expected_messages: extract exact system messages the user will see (success, error, warning, information dialogs). "
                    "For missing_gaps: identify areas the document mentions but does not explain adequately for automation. "
                    "For what_ai_learned: summarise the most important automation-relevant facts. "
                    "For what_ai_is_unsure_about: flag anything ambiguous or requiring manual clarification. "
                    "For readiness_score: rate 0-100 how ready this product's documentation is for automated test generation. "
                    "Do NOT return cover-page content, legal disclaimers, document version numbers, or generic section titles. "
                    "Extract real business content only."
                ),
                "required_schema": {
                    "modules_detected": ["string"],
                    "features_detected": ["string"],
                    "business_rules": ["string"],
                    "validations": ["string"],
                    "expected_messages": ["string"],
                    "missing_gaps": ["string"],
                    "what_ai_learned": ["string"],
                    "what_ai_is_unsure_about": ["string"],
                    "readiness_score": "number 0-100",
                },
            },
            max_tokens=900,
        )

    # ------------------------------------------------------------------ #
    #  Test case analysis                                                  #
    # ------------------------------------------------------------------ #

    def analyze_test_case(self, test_case: dict[str, Any], knowledge_context: list[str]) -> dict[str, Any]:
        compact_test = compact_test_case(test_case)
        context = select_relevant_context(knowledge_context, compact_test, limit=5, max_chars=900)
        return self._json_call(
            "Test case analysis",
            {
                "test_case": compact_test,
                "knowledge_context": context,
                "scoring_guide": {
                    "automation_readiness": (
                        "90-100: all steps deterministic, all objects in repo, standard patterns; "
                        "70-89: minor gaps, 1-2 objects need creation; "
                        "50-69: unclear steps, missing objects, conditional logic needed; "
                        "30-49: complex patterns, partial manual interaction; "
                        "0-29: not automatable (CAPTCHA, visual-only, uncontrollable popups)"
                    ),
                    "risk_score": (
                        "0-20: simple stable data entry; "
                        "21-40: navigation and read operations; "
                        "41-60: modals, dropdowns, conditional flow; "
                        "61-80: multi-window, dynamic content, file I/O; "
                        "81-100: external systems, timing-sensitive, auth screens"
                    ),
                    "quality_score": (
                        "90-100: precise steps, clear expected results, unambiguous test data; "
                        "70-89: mostly clear, minor gaps; "
                        "50-69: some vague steps or missing expected results; "
                        "0-49: too vague to automate without human review"
                    ),
                },
                "instructions": (
                    "Analyse this test case in the context of the provided knowledge. "
                    "Identify the application type, module, and feature it exercises. "
                    "List all preconditions that must be true before execution. "
                    "Score automation_readiness, risk_score, and quality_score using the scoring_guide. "
                    "Warn about any steps that are ambiguous, rely on dynamic data, or are inherently manual. "
                    "Set intent to a single sentence describing what this test case proves."
                ),
                "required_schema": {
                    "application_type": "SAP GUI | Web | Desktop | Hybrid | API-ready",
                    "module": "string",
                    "feature": "string",
                    "intent": "string",
                    "preconditions": ["string"],
                    "expected_result": "string",
                    "automation_readiness": "number 0-100",
                    "risk_score": "number 0-100",
                    "quality_score": "number 0-100",
                    "warnings": ["string"],
                },
            },
            max_tokens=1800,
        )

    # ------------------------------------------------------------------ #
    #  Chat-driven test case generation                                    #
    # ------------------------------------------------------------------ #

    def generate_test_case_from_request(
        self,
        request_text: str,
        product: dict[str, Any],
        knowledge_context: list[str],
        conversation_history: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        context = select_relevant_context(
            knowledge_context,
            {"request": request_text, "history": conversation_history or []},
            limit=6,
            max_chars=900,
        )
        return self._json_call(
            "Chat test case generation",
            {
                "conversation_history": conversation_history or [],
                "latest_user_message": request_text,
                "product_type": product.get("product_type") or product.get("type"),
                "knowledge_context": context,
                "instructions": (
                    "The user is chatting with you to get a test case written, mapped, and turned into a script, "
                    "for example starting with 'create a function Ztest1'. conversation_history holds every prior "
                    "turn in this conversation (role 'user' or 'assistant'); latest_user_message is what they just sent. "
                    "FIRST decide whether you have enough information to write a complete, unambiguous test case using "
                    "ONLY facts present in latest_user_message, conversation_history, and knowledge_context. "
                    "You need at minimum: which transaction/function/screen/t-code is being exercised, and concrete "
                    "values for any required input fields that knowledge_context does not supply a safe default for. "
                    "If something essential is missing or ambiguous and knowledge_context does not resolve it, set "
                    "needs_clarification to true, leave steps empty, and set clarification_question to ONE short, "
                    "specific question that asks for exactly the missing piece (e.g. 'Which T-code should Ztest1 be "
                    "created under?' or 'What value should I enter for the Function description?'). Do not ask about "
                    "things conversation_history already answered. "
                    "If you do have enough information (including from earlier answers in conversation_history), set "
                    "needs_clarification to false and write the full test case: "
                    "Ground every step in the guide: if the guide documents a UI prerequisite the request omits "
                    "(for example clicking 'New Entries', 'Add', or 'Create' before a row or field becomes editable), "
                    "include it as its own step in the correct order — never skip a guide-documented prerequisite. "
                    "Each step must be atomic (one user action: navigate, click, enter, save, or verify) and written "
                    "as an imperative instruction a human tester could follow by hand. "
                    "Set title to a short human-readable name for this test case. "
                    "Set expected_result to what should be true once the last step succeeds. "
                    "Set assistant_reply to a short, friendly 1-3 sentence chat reply: either the clarification_question "
                    "restated conversationally (when needs_clarification is true) or a summary of what you created."
                ),
                "required_schema": {
                    "needs_clarification": "boolean",
                    "clarification_question": "string",
                    "title": "string",
                    "module": "string",
                    "feature": "string",
                    "steps": ["string"],
                    "expected_result": "string",
                    "assumptions": ["string"],
                    "assistant_reply": "string",
                },
            },
            max_tokens=2200,
        )

    # ------------------------------------------------------------------ #
    #  Screenshot-grounded test case generation                           #
    # ------------------------------------------------------------------ #

    def generate_test_case_from_screenshot(
        self,
        image_base64: str,
        image_mime: str,
        prompt_text: str,
        product: dict[str, Any],
        knowledge_context: list[str] | None = None,
    ) -> dict[str, Any]:
        """Always runs on the local vision model (llama.cpp + mmproj), regardless of
        AI_PROVIDER — screenshot analysis never leaves the machine."""
        from app.ai.llamacpp_vision_provider import MISSING_VISION_MESSAGE, LlamaCppVisionProvider

        vision = LlamaCppVisionProvider()
        if not vision.configured:
            raise HTTPException(status_code=400, detail=MISSING_VISION_MESSAGE)

        context = select_relevant_context(knowledge_context or [], {"prompt": prompt_text}, limit=4, max_chars=700)
        payload = compact_ai_payload(
            {
                "product_type": product.get("product_type") or product.get("type"),
                "user_prompt": prompt_text,
                "knowledge_context": context,
                "instructions": (
                    "Look at the attached screenshot. user_prompt is the human's description of what screen this is "
                    "(for example 'its a login screen') — treat it as ground truth context, not something to second-guess. "
                    "Identify every visible field, button, label, and control in the image. "
                    "Write ONE complete, end-to-end functional test case that exercises this screen exactly as shown. "
                    "Ground every step ONLY in what is actually visible in the screenshot and in user_prompt — never "
                    "invent fields, buttons, menus, or behavior you cannot see. "
                    "Each step must be atomic (one user action: navigate, click, enter, select, or verify) and written "
                    "as an imperative instruction a human tester could follow by hand, ending with a verification step "
                    "that checks a visible, concrete result. "
                    "Set title to a short human-readable name. Set detected_elements to the concrete UI controls you "
                    "identified in the screenshot (field labels, button text). Set expected_result to what should be "
                    "true once the last step succeeds. Set assumptions to anything you had to guess because it wasn't "
                    "visible (e.g. valid credentials to use)."
                ),
                "required_schema": {
                    "title": "string",
                    "module": "string",
                    "feature": "string",
                    "steps": ["string"],
                    "expected_result": "string",
                    "detected_elements": ["string"],
                    "assumptions": ["string"],
                },
            }
        )
        response_schema = instruction_schema_to_json_schema(payload.get("required_schema", {}))
        try:
            response = vision.generate_json_from_image(
                system_prompt=TESTPILOT_SYSTEM_PROMPT,
                user_prompt=build_task_prompt("Screenshot-grounded test case generation", payload),
                image_base64=image_base64,
                image_mime=image_mime,
                response_schema=response_schema,
                max_output_tokens=900,
                temperature=0.15,
            )
            raw = normalize_json_text(response.text or "{}")
            parsed = json.loads(raw or "{}")
            parsed["ai_raw_response"] = raw or "{}"
            parsed["ai_provider"] = "local-vision"
            parsed["ai_model"] = response.model
            if response.usage:
                parsed["ai_usage"] = asdict(response.usage)
            return parsed
        except HTTPException:
            raise
        except AIProviderError as exc:
            raise HTTPException(status_code=exc.status_code, detail=f"Local vision model request failed: {exc.message}") from exc
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail=f"Local vision model returned invalid JSON: {exc}") from exc

    # ------------------------------------------------------------------ #
    #  End-to-end test suite generation                                    #
    # ------------------------------------------------------------------ #

    def generate_test_suite(
        self,
        product: dict[str, Any],
        knowledge_summary: dict[str, Any],
        knowledge_context: list[str],
        existing_titles: list[str],
        max_cases: int = 8,
    ) -> dict[str, Any]:
        context = select_relevant_context(
            knowledge_context,
            {"modules": knowledge_summary.get("modules_detected") or knowledge_summary.get("modules"), "features": knowledge_summary.get("features_detected") or knowledge_summary.get("features")},
            limit=8,
            max_chars=900,
        )
        return self._json_call(
            "End-to-end test suite generation",
            {
                "product_type": product.get("product_type") or product.get("type"),
                "modules_detected": knowledge_summary.get("modules_detected") or knowledge_summary.get("modules") or [],
                "features_detected": knowledge_summary.get("features_detected") or knowledge_summary.get("features") or [],
                "business_rules": knowledge_summary.get("business_rules") or [],
                "validations": knowledge_summary.get("validations") or [],
                "expected_messages": knowledge_summary.get("expected_messages") or [],
                "knowledge_context": context,
                "existing_test_case_titles": existing_titles[:40],
                "max_cases": max_cases,
                "instructions": (
                    "Write complete, end-to-end functional test cases grounded ONLY in facts present in "
                    "modules_detected, features_detected, business_rules, validations, expected_messages, and "
                    "knowledge_context — never invent screens, fields, transactions, or behavior that isn't documented. "
                    "Prioritise coverage breadth: one primary create/complete-flow test per major feature first, then "
                    "at least one negative/validation test grounded in business_rules or validations, and one test "
                    "that asserts an exact message from expected_messages when available. "
                    "Do NOT duplicate or rephrase anything in existing_test_case_titles — every test case must be new. "
                    "Each step must be atomic (one user action: navigate, click, enter, save, or verify) and written "
                    "as an imperative instruction a human tester could follow by hand, ending with a verification step. "
                    "Return at most max_cases test cases. Set coverage_summary to a short note on what was covered and "
                    "what remains untested due to insufficient documentation."
                ),
                "required_schema": {
                    "test_cases": [
                        {
                            "title": "string",
                            "module": "string",
                            "feature": "string",
                            "priority": "High | Medium | Low",
                            "steps": ["string"],
                            "expected_result": "string",
                        }
                    ],
                    "coverage_summary": "string",
                },
            },
            max_tokens=4500,
        )

    # ------------------------------------------------------------------ #
    #  Step mapping                                                        #
    # ------------------------------------------------------------------ #

    def map_test_steps(self, test_case: dict[str, Any], objects: list[dict[str, Any]], knowledge_context: list[str]) -> dict[str, Any]:
        compact_test = compact_test_case(test_case)
        checklist    = action_checklist(compact_test.get("steps", []))
        context      = select_relevant_context(knowledge_context, compact_test, limit=5, max_chars=900)
        return self._json_call(
            "Step mapping",
            {
                "test_case": compact_test,
                "available_objects": [compact_mapping_object(obj) for obj in objects[:20]],
                "knowledge_context": context,
                "required_action_checklist": checklist,
                "instructions": (
                    "Decompose every manual step into atomic automation actions. "
                    "Return one mapping object per item in required_action_checklist, preserving order — these are mandatory and must never be omitted or merged. "
                    "Additionally, if knowledge_context documents a UI prerequisite that the manual step text omits "
                    "(for example: 'click New Entries before the row becomes editable', 'press the Add (+) button before entering a new transaction code', "
                    "'click Create before the input fields appear'), insert an extra 'click' mapping for that prerequisite button "
                    "immediately before the checklist action it enables. Only insert a prerequisite step when knowledge_context "
                    "explicitly documents it and a matching object exists in available_objects — never invent UI behavior that isn't grounded in the supplied knowledge. "
                    "Do NOT omit navigation, mode changes, create/add actions, data entry, save/submit, or verification steps. "
                    "Use mapped_object_id ONLY from the supplied available_objects list; use null + needs_review when no safe match exists. "
                    "Assign sequential step_number values across all decomposed actions, including any inserted prerequisite steps. "
                    "For test_data: extract the exact value from the step instruction; use empty string if none specified. "
                    "For expected_result: describe what the system should do/show after this action. "
                    "SAP GUI action rules: "
                    "  - 'enter_text' → text fields (txt, ctxt prefix); "
                    "  - 'select' → tabs (tabp/tabs), menus (mbar/menu), radio buttons (rad), dropdowns (cmb/lst); "
                    "  - 'click' → buttons (btn) and toolbar items (tbar) ONLY; "
                    "  - 'verify' → all assertions, message checks, field value validation; "
                    "  - 'open' → launching a T-code or navigating to a transaction; "
                    "  - NEVER use 'click' for tabs, menus, or radio buttons."
                ),
                "required_schema": {
                    "overall_confidence": "number 0-100",
                    "mappings": [
                        {
                            "step_number": "integer",
                            "manual_step": "string",
                            "ai_understanding": "string",
                            "mapped_object_id": "integer or null",
                            "mapped_object_name": "string or null",
                            "automation_action": "open | enter_text | click | select | verify | upload | api_call | review",
                            "test_data": "string",
                            "expected_result": "string",
                            "confidence": "number 0-100",
                            "risk_score": "number 0-100",
                            "selected_reason": "string",
                            "alternative_objects": ["string"],
                            "status": "mapped | needs_review | unmapped",
                        }
                    ],
                },
            },
            max_tokens=4000,
        )

    def map_single_action(self, test_case: dict[str, Any], action_item: dict[str, Any], objects: list[dict[str, Any]], knowledge_context: list[str]) -> dict[str, Any]:
        compact_test = compact_test_case(test_case)
        context      = select_relevant_context(knowledge_context, {"action": action_item, "test_case": compact_test}, limit=3, max_chars=600)
        return self._json_call(
            "Single step mapping",
            {
                "test_case": {
                    "id":           compact_test.get("id"),
                    "title":        compact_test.get("title"),
                    "module":       compact_test.get("module"),
                    "feature":      compact_test.get("feature"),
                    "product_type": compact_test.get("product_type"),
                },
                "manual_step_order": action_item.get("manual_step_order"),
                "required_action":   action_item.get("required_action"),
                "available_objects": [compact_mapping_object(obj) for obj in objects[:12]],
                "knowledge_context": context,
                "instructions": (
                    "Pick the single best matching object from available_objects for this action. "
                    "Use null + needs_review when no safe match exists. "
                    "Apply SAP GUI rules: enter_text for text fields, select for tabs/menus/radios, click for buttons only, verify for assertions."
                ),
                "required_schema": {
                    "mapping": {
                        "manual_step_order":  "integer",
                        "manual_step":        "string",
                        "ai_understanding":   "string",
                        "mapped_object_id":   "integer or null",
                        "mapped_object_name": "string or null",
                        "automation_action":  "open | enter_text | click | select | verify | upload | api_call | review",
                        "test_data":          "string",
                        "expected_result":    "string",
                        "confidence":         "number 0-100",
                        "risk_score":         "number 0-100",
                        "selected_reason":    "string",
                        "alternative_objects": ["string"],
                        "status":             "mapped | needs_review | unmapped",
                    }
                },
            },
            max_tokens=600,
        )

    # ------------------------------------------------------------------ #
    #  Framework selection                                                 #
    # ------------------------------------------------------------------ #

    def select_framework(self, test_case: dict[str, Any], mappings: list[dict[str, Any]]) -> dict[str, Any]:
        return self._json_call(
            "Framework selection",
            {
                "test_case":             test_case,
                "mappings":              mappings,
                "supported_frameworks":  ["SAP_GUI_VBSCRIPT", "SELENIUM_JAVA", "PLAYWRIGHT", "CUCUMBER", "DESKTOP", "HYBRID"],
                "required_schema": {
                    "framework":   "string",
                    "confidence":  "number 0-100",
                    "reason":      "string",
                },
            },
        )

    # ------------------------------------------------------------------ #
    #  Script generation                                                   #
    # ------------------------------------------------------------------ #

    def generate_script(self, test_case: dict[str, Any], mappings: list[dict[str, Any]], framework: str) -> dict[str, Any]:
        result = self._json_call(
            "Script generation",
            {
                "test_case":         compact_test_case(test_case),
                "framework":         framework,
                "approved_mappings": [compact_generation_mapping(m) for m in mappings],
                "script_requirements": script_requirements(framework),
                "output_format": (
                    "Return the complete program as code_lines — exactly one source-code line per array item. "
                    "Do not embed newline characters inside any item. "
                    "The file must be fully executable when lines are joined with newlines."
                ),
                "required_schema": {
                    "file_name":  "string",
                    "code_lines": ["string"],
                    "risk_score": "number 0-100",
                    "notes":      ["string"],
                },
            },
            max_tokens=5000,
        )
        code_lines = result.pop("code_lines", None)
        if not isinstance(code_lines, list) or not all(isinstance(ln, str) for ln in code_lines):
            raise HTTPException(status_code=502, detail="AI provider returned invalid script code lines")
        result["code"] = "\n".join(code_lines)
        return result

    def review_script(self, script_code: str, framework: str) -> dict[str, Any]:
        return self._json_call(
            "Script review",
            {
                "framework":     framework,
                "script_code":   script_code[:50000],
                "review_policy": (
                    "Approved mapped locators and test data are intentional, not hardcoding defects. "
                    "Score only concrete execution, safety, verification, wait, and error-handling risks. "
                    "Recommend approve when no blocking issue remains."
                ),
                "required_schema": {
                    "issues":                    ["string"],
                    "risk_warnings":             ["string"],
                    "hardcoded_values":          ["string"],
                    "missing_waits":             ["string"],
                    "missing_assertions":        ["string"],
                    "weak_error_handling":       ["string"],
                    "recommended_improvements":  ["string"],
                    "approval_recommendation":   "approve | needs_changes | blocked",
                    "risk_score":                "number 0-100",
                },
            },
            max_tokens=2500,
        )

    def generate_and_review_script(self, test_case: dict[str, Any], mappings: list[dict[str, Any]], framework: str) -> dict[str, Any]:
        """Generate and review in one call to halve latency."""
        result = self._json_call(
            "Script generation and review",
            {
                "test_case":         compact_test_case(test_case),
                "framework":         framework,
                "approved_mappings": [compact_generation_mapping(m) for m in mappings],
                "script_requirements": script_requirements(framework),
                "instructions": (
                    "Generate the complete, executable script first. "
                    "Then review that exact script for quality issues. "
                    "Return one source line per code_lines item — no embedded newlines."
                ),
                "required_schema": {
                    "file_name":  "string",
                    "code_lines": ["string"],
                    "risk_score": "number 0-100",
                    "notes":      ["string"],
                    "review": {
                        "issues":                   ["string"],
                        "risk_warnings":            ["string"],
                        "hardcoded_values":         ["string"],
                        "missing_waits":            ["string"],
                        "missing_assertions":       ["string"],
                        "weak_error_handling":      ["string"],
                        "recommended_improvements": ["string"],
                        "approval_recommendation":  "approve | needs_changes | blocked",
                        "risk_score":               "number 0-100",
                    },
                },
            },
            max_tokens=4000,
        )
        code_lines = result.pop("code_lines", None)
        if not isinstance(code_lines, list) or not all(isinstance(ln, str) for ln in code_lines):
            raise HTTPException(status_code=502, detail="AI provider returned invalid script code lines")
        result["code"] = "\n".join(code_lines)
        if not isinstance(result.get("review"), dict):
            raise HTTPException(status_code=502, detail="AI provider did not return the required script review")
        return result

    # ------------------------------------------------------------------ #
    #  Failure analysis                                                    #
    # ------------------------------------------------------------------ #

    def analyze_failure(self, execution_logs: list[str], script_code: str, mappings: list[dict[str, Any]]) -> dict[str, Any]:
        # Pre-process logs to highlight errors before sending to model
        structured = _parse_execution_logs(execution_logs)
        return self._json_call(
            "Failure analysis",
            {
                "log_summary": structured,
                "raw_logs_tail": execution_logs[-30:] if len(execution_logs) > 30 else execution_logs,
                "script_code": script_code[:20000],
                "mappings": mappings[:20],
                "instructions": (
                    "Analyse the execution logs to identify the root cause of the failure. "
                    "Focus on the first ERROR or EXCEPTION line — that is usually the real failure point. "
                    "For category: choose object_issue when a UI element is not found or has wrong path; "
                    "data_issue when test data causes a validation error; "
                    "timing_issue when the script acts before the screen is ready; "
                    "environment_issue when SAP or the app itself is down or misconfigured; "
                    "script_logic_issue when the script takes wrong actions in the right order; "
                    "runner_issue when the test framework or execution engine itself fails; "
                    "auth_issue when a permissions or login problem blocks execution; "
                    "unknown when the cause cannot be determined from the provided data. "
                    "For auto_heal_possible: set true only when the failure is an object_issue with a clear path change. "
                    "For suggested_fix: give a concrete, actionable fix — not a generic suggestion."
                ),
                "required_schema": {
                    "likely_root_cause":   "string",
                    "category":            "object_issue | data_issue | timing_issue | environment_issue | script_logic_issue | runner_issue | auth_issue | unknown",
                    "failed_object":       "string or null",
                    "failed_at_step":      "integer or null",
                    "suggested_fix":       "string",
                    "auto_heal_possible":  "boolean",
                    "confidence":          "number 0-100",
                    "bug_draft": {
                        "title":       "string",
                        "description": "string",
                        "severity":    "Critical | High | Medium | Low",
                    },
                },
            },
            max_tokens=2000,
        )

    # ------------------------------------------------------------------ #
    #  Auto-heal                                                           #
    # ------------------------------------------------------------------ #

    def suggest_auto_heal(self, failed_object: dict[str, Any], available_objects: list[dict[str, Any]], failure_context: dict[str, Any]) -> dict[str, Any]:
        path_history = failed_object.get("path_history") or []
        return self._json_call(
            "Auto-heal reasoning",
            {
                "failed_object": {
                    "id":            failed_object.get("id"),
                    "object_name":   failed_object.get("object_name"),
                    "object_type":   failed_object.get("object_type"),
                    "current_path":  failed_object.get("technical_path") or failed_object.get("locator"),
                    "module":        failed_object.get("module"),
                    "feature":       failed_object.get("feature"),
                    "last_verified": failed_object.get("last_verified"),
                    "path_history":  [{"before": h.get("before"), "after": h.get("after")} for h in path_history[-5:]],
                },
                "available_objects": [compact_mapping_object(obj) for obj in available_objects[:15]],
                "failure_context":   failure_context,
                "instructions": (
                    "The failed_object's technical path no longer works. "
                    "Examine path_history to understand how this object's path has changed before. "
                    "Search available_objects for an object with the same object_name, module, feature, or object_type. "
                    "Prefer objects with the same ID prefix as the original path. "
                    "If a clear match exists, propose that object's path as suggested_path. "
                    "Set confidence high (>75) only when the match is unambiguous. "
                    "Set confidence below 50 when you are guessing — the user will review before applying."
                ),
                "required_schema": {
                    "old_path":       "string",
                    "suggested_path": "string",
                    "matched_object": "string or null",
                    "reason":         "string",
                    "confidence":     "number 0-100",
                    "risk_score":     "number 0-100",
                    "status":         "Pending Review",
                },
            },
        )

    # ------------------------------------------------------------------ #
    #  Coverage & regression                                               #
    # ------------------------------------------------------------------ #

    def generate_coverage_gaps(self, product: dict[str, Any], knowledge_summary: dict[str, Any], test_cases: list[dict[str, Any]], objects: list[dict[str, Any]]) -> dict[str, Any]:
        return self._json_call(
            "Coverage gap suggestions",
            {
                "product":           product,
                "knowledge_summary": knowledge_summary,
                "test_cases":        test_cases,
                "objects":           objects,
                "required_schema": {
                    "missing_feature_coverage":   ["string"],
                    "missing_object_coverage":    ["string"],
                    "missing_negative_testing":   ["string"],
                    "weak_expected_results":      ["string"],
                    "high_risk_untested_areas":   ["string"],
                    "recommendations":            ["string"],
                },
            },
        )

    def explain_regression_impact(self, changed_object: dict[str, Any], impacted_mappings: list[dict[str, Any]], impacted_scripts: list[dict[str, Any]]) -> dict[str, Any]:
        return self._json_call(
            "Regression impact explanation",
            {
                "changed_object":    changed_object,
                "impacted_mappings": impacted_mappings,
                "impacted_scripts":  impacted_scripts,
                "required_schema": {
                    "impact_level":          "low | medium | high",
                    "impacted_test_cases":   ["string"],
                    "impacted_scripts":      ["string"],
                    "recommended_actions":   ["string"],
                    "explanation":           "string",
                },
            },
        )

    # ------------------------------------------------------------------ #
    #  Core JSON call                                                      #
    # ------------------------------------------------------------------ #

    def _json_call(self, task: str, payload: dict[str, Any], max_tokens: int = 3000) -> dict[str, Any]:
        if not self.provider.configured:
            message = MISSING_LOCAL_AI_MESSAGE if self.provider.provider_name == "local" else MISSING_AI_KEY_MESSAGE
            raise HTTPException(status_code=400, detail=message)

        try:
            payload         = compact_ai_payload(payload)
            response_schema = instruction_schema_to_json_schema(payload.get("required_schema", {}))
            response        = self.provider.generate_json(
                system_prompt=TESTPILOT_SYSTEM_PROMPT,
                user_prompt=build_task_prompt(task, payload),
                response_schema=response_schema,
                temperature=0.15,
                max_output_tokens=max_tokens,
            )
            raw    = normalize_json_text(response.text or "{}")
            parsed = json.loads(raw or "{}")
            parsed["ai_raw_response"] = raw or "{}"
            parsed["ai_provider"]     = self.provider.provider_name
            parsed["ai_model"]        = response.model
            if response.usage:
                parsed["ai_usage"] = asdict(response.usage)
            return parsed

        except HTTPException:
            raise
        except AIProviderError as exc:
            provider_label = (
                "OpenAI"   if exc.provider_name.lower() == "openai" else
                "Local AI" if exc.provider_name.lower() == "local"  else
                exc.provider_name.capitalize()
            )
            raise HTTPException(status_code=exc.status_code, detail=f"{provider_label} request failed for {task}: {exc.message}") from exc
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail=f"AI provider returned invalid JSON for {task}: {exc}") from exc
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=502, detail=f"AI provider request failed for {task}: {exc}") from exc

    @staticmethod
    def action_from_step(step: str) -> str:
        text = step.lower()
        if any(w in text for w in ["enter", "type", "input", "fill"]):
            return "enter_text"
        if any(w in text for w in ["verify", "validate", "assert", "check", "should", "confirm"]):
            return "verify"
        if any(w in text for w in ["upload", "attach"]):
            return "upload"
        if any(w in text for w in ["select", "choose", "pick", "tab to", "switch to"]):
            return "select"
        if any(w in text for w in ["click", "press", "tap", "submit", "save"]):
            return "click"
        if any(w in text for w in ["open", "navigate", "launch", "go to", "transaction"]):
            return "open"
        return "review"


# ======================================================================= #
#  Script requirements                                                     #
# ======================================================================= #

def script_requirements(framework: str) -> list[str]:
    normalized = framework.upper().replace(" ", "_").replace("-", "_")
    common = [
        "Execute every approved mapping exactly once and in step_number order.",
        "Use the exact mapped technical_path and test_data values from approved_mappings.",
        "Never substitute one mapped field value for another.",
        "Stop immediately when any action fails — never continue to save or submit after an error.",
        "Include a descriptive comment above each manual step block.",
        "Include safe error handling around every UI interaction.",
        "Include evidence / screenshot placeholder after critical verify steps.",
    ]
    if "SAP" in normalized or "VBSCRIPT" in normalized:
        return [
            "Generate a complete, executable .vbs file.",
            "Start with: Option Explicit",
            "On Error Resume Next must appear immediately after Option Explicit.",
            "",
            "STANDARD HELPER SUBROUTINES — include all four:",
            "  Sub WaitForSap(oSession)",
            "    Dim i : For i = 1 To 30",
            "      If Not oSession.Busy Then Exit Sub",
            "      WScript.Sleep 500",
            "    Next",
            "  End Sub",
            "",
            "  Sub CheckStep(sStep, oSession)",
            "    If Err.Number <> 0 Then",
            "      WScript.Echo \"FAIL [\" & sStep & \"]: \" & Err.Description",
            "      Err.Clear : WScript.Quit 1",
            "    End If",
            "    WaitForSap oSession",
            "  End Sub",
            "",
            "  Sub CheckStatusBar(sStep, oSession, sExpected)",
            "    Dim sMsg : sMsg = oSession.findById(\"wnd[0]/sbar\").Text",
            "    If InStr(LCase(sMsg), LCase(sExpected)) = 0 Then",
            "      WScript.Echo \"FAIL [\" & sStep & \"] Expected '\" & sExpected & \"' in status bar, got: \" & sMsg",
            "      WScript.Quit 1",
            "    End If",
            "  End Sub",
            "",
            "  Sub FailStep(sStep, sReason)",
            "    WScript.Echo \"FAIL [\" & sStep & \"]: \" & sReason",
            "    WScript.Quit 1",
            "  End Sub",
            "",
            "SAP GUI METHOD RULES — choose by object_type / ID prefix, NOT by action verb:",
            "  text field      (txt, ctxt prefix) → .Text = \"value\"",
            "  button/toolbar  (btn, tbar prefix)  → .Press",
            "  tab/tabstrip    (tabp, tabs prefix)  → .Select",
            "  menu/menuitem   (mbar, menu prefix)  → .Select",
            "  radio button    (rad prefix)         → .Select",
            "  checkbox        (chk prefix)         → .Selected = True / False",
            "  combobox        (cmb, lst prefix)    → .Key = \"value\"  (or .ShowList if no value)",
            "  ALV grid cell   (shell GridView)     → .SetCurrentCell row, \"col\" then .DoubleClickCurrentCell or .PressF2",
            "  tree node       (shell Tree)         → .SelectItem \"NodeKey\"",
            "  table cell      (tbl / TableControl) → .GetCell(row, col).Text = \"value\"",
            "  popup button    (wnd[1]/...btn)      → .Press",
            "  status bar      (sbar)               → .Text  (READ ONLY — verify steps only)",
            "",
            "NEVER use .Press on a tab, menu, radio button, or checkbox.",
            "NEVER use .Text = on a button, tab, menu, or combobox.",
            "NEVER use .Select on a text field or button.",
            "After every findById call that writes or clicks, call WaitForSap and CheckStep.",
            "For every verify step: read the value, compare to expected, call FailStep if mismatch.",
            *common,
        ]
    if "SELENIUM" in normalized:
        return [
            "Generate a complete Java class with JUnit 5 annotations.",
            "Include WebDriverManager setup in @BeforeEach.",
            "Use By.xpath or By.cssSelector with locators from mappings.",
            "Include WebDriverWait (explicit waits) — never Thread.sleep.",
            "Include TakesScreenshot call in @AfterEach for evidence.",
            *common,
        ]
    if "PLAYWRIGHT" in normalized:
        return [
            "Generate a complete Playwright TypeScript .spec.ts file.",
            "Use page.goto() for navigation steps.",
            "Use page.locator() with mapped technical_path values.",
            "Use expect() assertions for every verify step.",
            "Use page.waitForSelector() before interacting with dynamic elements.",
            *common,
        ]
    if "CUCUMBER" in normalized:
        return [
            "Generate both a .feature file (Gherkin) and Java step definition stubs.",
            "Map each manual step to a Given/When/Then keyword logically.",
            "Include placeholder @DataTable parameter for data-driven steps.",
            *common,
        ]
    if "DESKTOP" in normalized:
        return [
            "Generate a desktop automation script using the mapped control paths.",
            "Include process launch and teardown steps.",
            *common,
        ]
    return ["Generate a hybrid execution plan with runner placeholder steps.", *common]


# ======================================================================= #
#  Utility helpers                                                         #
# ======================================================================= #

def safe_action_from_text(step: str) -> str:
    return TestPilotAgent.action_from_step(step)


def extract_json_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    if value:
        return [str(value)]
    return []


def normalize_json_text(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    extracted = extract_first_json_object(text)
    return extracted or text.strip()


def extract_first_json_object(text: str) -> str:
    start = text.find("{")
    if start < 0:
        return ""
    depth, in_string, escape = 0, False, False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1].strip()
    last = text.rfind("}")
    if last > start:
        return text[start:last + 1].strip()
    return ""


# Fields that add noise / bloat without aiding AI decisions
_DROP_AI_KEYS = {
    "ai_raw_response", "created_at", "updated_at", "before_value", "after_value",
    "path_history", "notes", "last_verified", "decided_at", "processed_at",
}


def compact_ai_payload(value: Any, *, depth: int = 0) -> Any:
    """Remove noise and keep the AI context within a reasonable token budget."""
    if depth > 12:
        return None
    if isinstance(value, dict):
        return {
            key: compact_ai_payload(item, depth=depth + 1)
            for key, item in value.items()
            if key not in _DROP_AI_KEYS and item not in (None, "", [], {})
        }
    if isinstance(value, list):
        return [compact_ai_payload(item, depth=depth + 1) for item in value[:32]]
    if isinstance(value, str):
        return value if len(value) <= 1800 else value[:1800] + "..."
    return value


def select_relevant_context(chunks: list[str], query: dict[str, Any], *, limit: int = 4, max_chars: int = 700) -> list[str]:
    """BM25-inspired context selection with bigram bonus.

    Ranks knowledge chunks by term overlap with the query, giving double weight
    to matching bigrams (adjacent word pairs) for better precision.
    """
    query_text  = json.dumps(query, ensure_ascii=False, default=str).lower()
    token_list  = [t for t in re.findall(r"[a-z0-9_/.-]+", query_text) if len(t) > 2]
    tokens      = set(token_list)
    bigrams     = {f"{token_list[i]} {token_list[i + 1]}" for i in range(len(token_list) - 1)}

    def score(chunk: str) -> tuple[float, int]:
        lowered     = chunk.lower()
        term_hits   = sum(1 for t in tokens if t in lowered)
        bigram_hits = sum(2 for b in bigrams if b in lowered)
        return (term_hits + bigram_hits, -len(chunk))

    ranked = sorted(
        (str(c) for c in chunks if str(c).strip()),
        key=score,
        reverse=True,
    )
    return [c[:max_chars] for c in ranked[:limit]]


# ======================================================================= #
#  Knowledge profile builder                                               #
# ======================================================================= #

_GENERIC_KNOWLEDGE_LABELS = {
    "user guide", "installation", "initial configuration",
    "installation & initial configuration", "warranty", "disclaimer",
    "warranty and disclaimer", "document version", "document scope",
    "table of contents", "copyright",
}


def knowledge_profile(text: str, *, max_headings: int = 45, max_excerpts: int = 12) -> dict[str, Any]:
    """Build a dense, structured document profile for knowledge extraction.

    Strategy:
    1. Extract ALL numbered section headings as structural signal.
    2. Sample the document densely (every ~40 lines) so the model sees
       content from throughout the document — not just the cover page.
    3. Add per-heading excerpts so each section's opening paragraph is
       visible to the model.
    """
    raw_lines = [normalize_knowledge_line(line) for line in str(text or "").splitlines()]
    lines     = [line for line in raw_lines if line]
    headings  = detect_knowledge_headings(lines)

    modules  = unique_non_generic([h["title"] for h in headings if h["level"] <= 2], max_items=24)
    features = unique_non_generic([h["title"] for h in headings if h["level"] >= 2], max_items=40)
    if not features:
        features = unique_non_generic([ln for ln in lines if looks_like_process_line(ln)], max_items=40)

    excerpts: list[str] = []

    # Dense uniform sampling across the whole document
    if lines:
        n_windows = min(10, max(4, len(lines) // 80))
        step      = max(1, len(lines) // n_windows)
        for start in range(0, len(lines), step):
            sample = " ".join(lines[start: start + 14]).strip()
            if sample and sample not in excerpts:
                excerpts.append(sample[:700])

    # Heading-anchored excerpts (opening paragraph of each section)
    for heading in headings[:max_headings]:
        li     = heading["line_index"]
        sample = " ".join(lines[li: li + 8]).strip()
        if sample and sample not in excerpts:
            excerpts.append(sample[:700])
        if len(excerpts) >= max_excerpts * 2:
            break

    return {
        "line_count":              len(lines),
        "char_count":              len(text or ""),
        "section_headings":        [h["title"] for h in headings[:max_headings]],
        "candidate_modules":       modules,
        "candidate_features":      features,
        "representative_excerpts": excerpts[:max_excerpts],
    }


def normalize_knowledge_line(value: str) -> str:
    line = re.sub(
        r"\s+", " ",
        str(value or "")
            .replace("", " ")
            .replace("â¢", " ")
            .replace("â", " -> "),
    ).strip(" -\t")
    return line.replace("TM", "").strip()


def detect_knowledge_headings(lines: list[str]) -> list[dict[str, Any]]:
    headings: list[dict[str, Any]] = []
    seen:     set[str]              = set()
    for index, line in enumerate(lines):
        match = re.match(
            r"^(?P<number>\d+(?:\.\d+){0,4})[.)]?\s+(?P<title>[A-Z][A-Za-z0-9/&()'\":,\- ]{3,120})$",
            line,
        )
        if not match:
            continue
        title = clean_heading_title(match.group("title"))
        key   = title.lower()
        if not title or key in seen or is_generic_knowledge_label(title):
            continue
        if re.search(r"\b(page|release|version|security weaver)\b", title, re.IGNORECASE):
            continue
        seen.add(key)
        level = match.group("number").count(".") + 1
        headings.append({"title": title, "level": level, "line_index": index})
    return headings


def clean_heading_title(title: str) -> str:
    title = re.sub(r"\s+\d{1,4}$", "", title.strip(" .:-"))
    return re.sub(r"\s+", " ", title)[:120]


def is_generic_knowledge_label(value: str) -> bool:
    lowered = re.sub(r"[^a-z0-9& ]+", "", value.lower()).strip()
    if lowered in _GENERIC_KNOWLEDGE_LABELS:
        return True
    if re.match(r"^(go to transaction|tab |button |click |enter |below enter|repeat steps)\b", lowered):
        return True
    return any(label in lowered for label in ("copyright", "document version", "license agreement"))


def unique_non_generic(values: list[str], *, max_items: int) -> list[str]:
    result: list[str] = []
    seen:   set[str]  = set()
    for value in values:
        cleaned = clean_heading_title(value)
        key     = cleaned.lower()
        if not cleaned or key in seen or is_generic_knowledge_label(cleaned):
            continue
        seen.add(key)
        result.append(cleaned)
        if len(result) >= max_items:
            break
    return result


def looks_like_process_line(line: str) -> bool:
    return (
        bool(re.search(
            r"\b(create|maintain|import|export|upload|download|analyze|review|simulate|"
            r"transport|configure|execute|monitor|report|process|validate|approve|reject|"
            r"delete|archive|search|display|print|post|reverse|cancel)\b",
            line,
            re.IGNORECASE,
        ))
        and 8 <= len(line) <= 140
    )


# ======================================================================= #
#  Payload compaction helpers                                              #
# ======================================================================= #

def compact_mapping_object(item: dict[str, Any]) -> dict[str, Any]:
    aliases = extract_json_list(item.get("aliases"))[:3]
    actions = extract_json_list(item.get("supported_actions"))[:4]
    raw_path = str(item.get("technical_path") or item.get("locator") or "")
    technical_path = "" if len(raw_path) > 260 else short_text(raw_path, 200)
    return {
        key: value
        for key, value in {
            "id":               item.get("id"),
            "object_name":      short_text(item.get("object_name"), 100),
            "module":           short_text(item.get("module"), 60),
            "feature":          short_text(item.get("feature"), 80),
            "screen":           short_text(item.get("screen"), 100),
            "area_or_tab":      short_text(item.get("area_or_tab") or item.get("areaOrTab"), 80),
            "object_type":      item.get("object_type") or item.get("objectType"),
            "technical_path":   technical_path,
            "supported_actions": actions,
            "aliases":          [short_text(a, 60) for a in aliases],
            "confidence":       item.get("confidence"),
        }.items()
        if value not in (None, "", [], {})
    }


def short_text(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[:limit]


def compact_test_case(item: dict[str, Any]) -> dict[str, Any]:
    step_items = item.get("step_items") or item.get("stepItems") or []
    return {
        key: value
        for key, value in {
            "id":              item.get("id"),
            "external_id":     item.get("external_id") or item.get("externalId"),
            "title":           item.get("title"),
            "module":          item.get("module"),
            "feature":         item.get("feature"),
            "priority":        item.get("priority"),
            "expected_result": item.get("expected_result") or item.get("expectedResult"),
            "product_type":    item.get("product_type"),
            "steps": [
                {
                    "order":           step.get("order"),
                    "instruction":     step.get("instruction"),
                    "expected_result": step.get("expected_result") or step.get("expectedResult"),
                }
                for step in step_items
            ],
        }.items()
        if value not in (None, "", [], {})
    }


def compact_generation_mapping(item: dict[str, Any]) -> dict[str, Any]:
    obj = item.get("object") if isinstance(item.get("object"), dict) else {}
    return {
        key: value
        for key, value in {
            "step_number":    item.get("step_number"),
            "manual_step":    item.get("manual_step") or item.get("manualStep"),
            "action":         item.get("automation_action") or item.get("action"),
            "test_data":      item.get("test_data"),
            "expected_result": item.get("expected_result"),
            "object_name":    item.get("mapped_object") or item.get("mappedObject") or obj.get("object_name"),
            "technical_path": obj.get("technical_path") or obj.get("locator"),
            "object_type":    obj.get("object_type"),
            "supported_actions": obj.get("supported_actions"),
        }.items()
        if value not in (None, "", [], {})
    }


def action_checklist(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    checklist: list[dict[str, Any]] = []
    verb_pattern = re.compile(
        r"\b(execute|open|navigate|click|press|select|choose|enter|type|fill|add|save|submit|verify|check|confirm|validate|create|delete|upload)\b",
        re.IGNORECASE,
    )
    for step in steps:
        instruction = str(step.get("instruction") or "")
        raw_matches = list(verb_pattern.finditer(instruction))
        matches: list[re.Match] = []
        for match in raw_matches:
            verb   = match.group(0).lower()
            prefix = instruction[max(0, match.start() - 14): match.start()].lower()
            if verb in {"create", "add", "save", "submit", "delete"} and re.search(r"(click|press)\s+(on\s+)?$", prefix):
                continue
            matches.append(match)
        for index, match in enumerate(matches):
            end    = matches[index + 1].start() if index + 1 < len(matches) else len(instruction)
            clause = instruction[match.start(): end].strip(" ,.;")
            if clause:
                checklist.append({"manual_step_order": step.get("order"), "required_action": clause})
    return checklist


# ======================================================================= #
#  Log parsing helper                                                      #
# ======================================================================= #

_ERROR_PATTERN = re.compile(
    r"(?P<level>ERROR|EXCEPTION|FAIL|FATAL|WARN|WARNING|CRITICAL)[\s:]+(?P<msg>.+)",
    re.IGNORECASE,
)
_STEP_PATTERN = re.compile(r"(?:step|action)\s*[:\-#]?\s*(\d+)", re.IGNORECASE)


def _parse_execution_logs(logs: list[str]) -> dict[str, Any]:
    """Extract structured signal from raw execution log lines."""
    errors:       list[str] = []
    warnings:     list[str] = []
    first_error:  str | None = None
    failed_step:  int | None = None
    total_lines = len(logs)

    for line in logs:
        m = _ERROR_PATTERN.search(line)
        if not m:
            continue
        level = m.group("level").upper()
        msg   = m.group("msg").strip()[:300]
        if level in ("ERROR", "EXCEPTION", "FAIL", "FATAL", "CRITICAL"):
            if first_error is None:
                first_error = msg
                sm = _STEP_PATTERN.search(line)
                if sm:
                    try:
                        failed_step = int(sm.group(1))
                    except ValueError:
                        pass
            errors.append(msg)
        else:
            warnings.append(msg)

    return {
        "total_log_lines": total_lines,
        "error_count":     len(errors),
        "warning_count":   len(warnings),
        "first_error":     first_error,
        "failed_step":     failed_step,
        "errors":          errors[:15],
        "warnings":        warnings[:10],
    }
