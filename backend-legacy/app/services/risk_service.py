from typing import Any


class RiskService:
    def generation_blockers(self, test_case: dict[str, Any], mappings: list[dict[str, Any]], minimum_confidence: float, maximum_risk: float) -> list[str]:
        blockers: list[str] = []
        if not mappings:
            blockers.append("Test case has no mapped steps")
        if any(mapping.get("status") == "unmapped" or (not mapping.get("approved") and float(mapping.get("confidence") or 0) < minimum_confidence) for mapping in mappings):
            blockers.append("One or more mappings are unmapped, unapproved, or below confidence threshold")
        if float(test_case.get("risk_score") or 0) > maximum_risk:
            blockers.append("Test case risk score exceeds maximum allowed risk")
        if any(float(mapping.get("risk_score") or 0) > maximum_risk for mapping in mappings):
            blockers.append("One or more mappings exceed maximum allowed risk")
        return blockers
