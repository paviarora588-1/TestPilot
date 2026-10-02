from typing import Any


class RegressionService:
    def impacted_entities(self, changed_object: dict[str, Any] | None, mappings: list[dict[str, Any]], scripts: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "changed_object": changed_object,
            "impacted_mappings": mappings,
            "impacted_scripts": scripts,
            "impact_count": len(mappings) + len(scripts),
        }
