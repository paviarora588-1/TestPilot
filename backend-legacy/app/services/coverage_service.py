from typing import Any


class CoverageService:
    def gaps(self, knowledge_summary: dict[str, Any], test_cases: list[dict[str, Any]], objects: list[dict[str, Any]]) -> dict[str, Any]:
        features = set(knowledge_summary.get("features") or knowledge_summary.get("features_detected_list") or [])
        tested_features = {case.get("feature") for case in test_cases if case.get("feature")}
        object_names = {obj.get("object_name") or obj.get("objectName") for obj in objects if obj.get("object_name") or obj.get("objectName")}
        return {
            "missing_feature_coverage": sorted(features - tested_features),
            "missing_object_coverage": sorted(object_names),
            "weak_expected_results": [
                case.get("external_id") or case.get("externalId")
                for case in test_cases
                if len(str(case.get("expected_result") or case.get("expectedResult") or "").split()) < 4
            ],
        }
