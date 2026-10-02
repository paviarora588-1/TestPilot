from app.agents.testpilot_agent import TestPilotAgent


class ReportService:
    def __init__(self) -> None:
        self.agent = TestPilotAgent()

    def summary(self, product_id: int):
        return self.agent.generate_report(product_id)

    def coverage(self, product_id: int):
        return {
            "product_id": product_id,
            "modules": [
                {"module": "Role Catalog", "coverage": 78},
                {"module": "Generic Upload", "coverage": 74},
                {"module": "Hybrid Flow", "coverage": 55},
            ],
        }
