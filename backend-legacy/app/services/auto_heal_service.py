from app.agents.testpilot_agent import TestPilotAgent
from app.services.store import store


class AutoHealService:
    def __init__(self) -> None:
        self.agent = TestPilotAgent()

    def analyze_failure(self, execution_id: int):
        result = self.agent.analyze_failure(execution_id)
        store.add_history(1, "TestPilot Agent", "failure analyzed", "ExecutionRun", str(execution_id), "Review", "Failure analyzed")
        return result

    def suggest(self, execution_id: int):
        result = self.agent.suggest_auto_heal(execution_id)
        suggestion = {"id": store.next_id("auto_heal"), "execution_id": execution_id, **result}
        store.auto_heal.append(suggestion)
        store.add_history(1, "TestPilot Agent", "auto-heal suggested", "AutoHealSuggestion", str(suggestion["id"]), "Review", suggestion["reason"])
        return suggestion

    def approve(self, suggestion_id: int):
        suggestion = next((s for s in store.auto_heal if s["id"] == suggestion_id), {"id": suggestion_id})
        suggestion["status"] = "Approved"
        store.add_history(1, "User", "auto-heal approved", "AutoHealSuggestion", str(suggestion_id), "Approved", "Suggestion approved for repository update")
        return suggestion

    def reject(self, suggestion_id: int):
        return {"id": suggestion_id, "status": "Rejected"}
