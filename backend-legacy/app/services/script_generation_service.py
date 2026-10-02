from app.agents.testpilot_agent import TestPilotAgent
from app.services.store import store


class ScriptGenerationService:
    def __init__(self) -> None:
        self.agent = TestPilotAgent()

    def generate(self, test_case_id: int, framework: str = "Hybrid Runner"):
        result = self.agent.generate_script(test_case_id, framework)
        script = {"id": store.next_id("scripts"), "test_case_id": test_case_id, "framework": framework, **result}
        store.scripts.append(script)
        store.add_history(1, "TestPilot Agent", "script generated", "GeneratedScript", str(script["id"]), "Success", f"{framework} script generated")
        return script

    def get(self, script_id: int):
        return next((s for s in store.scripts if s["id"] == script_id), {"id": script_id, "framework": "Hybrid Runner", "code": "// script not found in mock store"})

    def review(self, script_id: int):
        return self.agent.review_script(script_id)
