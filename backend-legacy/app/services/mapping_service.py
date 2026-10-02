from app.agents.testpilot_agent import TestPilotAgent
from app.services.store import store


class MappingService:
    def __init__(self) -> None:
        self.agent = TestPilotAgent()

    def analyze(self, test_case_id: int):
        return self.agent.analyze_test_case(test_case_id)

    def map_steps(self, test_case_id: int):
        result = self.agent.map_test_steps(test_case_id)
        mapping = {"id": store.next_id("mappings"), "test_case_id": test_case_id, "status": "Review", **result}
        store.mappings.append(mapping)
        store.add_history(1, "TestPilot Agent", "mapping generated", "TestCase", str(test_case_id), "Review", "Step mapping generated")
        return mapping

    def approve(self, mapping_id: int):
        mapping = next((m for m in store.mappings if m["id"] == mapping_id), {"id": mapping_id})
        mapping["status"] = "Approved"
        store.add_history(1, "User", "mapping approved", "StepMapping", str(mapping_id), "Approved", "Mapping approved for script generation")
        return mapping

    def regenerate(self, mapping_id: int):
        return {"id": mapping_id, "status": "Regenerated", "confidence": 91}
