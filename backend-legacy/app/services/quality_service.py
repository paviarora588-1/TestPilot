import re
from typing import Any


class QualityService:
    def score(self, test_case: dict[str, Any], peers: list[dict[str, Any]]) -> dict[str, Any]:
        steps = test_case.get("step_items") or []
        expected = str(test_case.get("expected_result") or test_case.get("expectedResult") or "").strip()
        issues: list[str] = []
        steps_text = "\n".join(str(step.get("instruction", "")) for step in steps)

        if not expected:
            issues.append("Missing expected result")
        elif len(expected.split()) < 4:
            issues.append("Weak expected result")
        if any(len(re.split(r"\band\b|,", str(step.get("instruction", "")), flags=re.IGNORECASE)) > 3 for step in steps):
            issues.append("Too many actions in one step")
        if not re.search(r"\bverify|validate|assert|check|should\b", steps_text, re.IGNORECASE):
            issues.append("No assertion")
        if any(peer.get("id") != test_case.get("id") and str(peer.get("title", "")).strip().lower() == str(test_case.get("title", "")).strip().lower() for peer in peers):
            issues.append("Duplicate title")

        return {"quality_score": max(0, 100 - len(issues) * 14), "issues": issues}
