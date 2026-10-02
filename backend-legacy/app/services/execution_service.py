from app.runners.hybrid_runner import HybridRunner
from app.services.store import store


class ExecutionService:
    def __init__(self) -> None:
        self.runner = HybridRunner()

    def execute(self, script_id: int):
        result = self.runner.run({"script_id": script_id})
        execution = {"id": store.next_id("executions"), "product_id": 1, "script_id": script_id, **result}
        store.executions.append(execution)
        store.add_history(1, "TestPilot Agent", "execution completed", "ExecutionRun", str(execution["id"]), result["status"], "Execution completed in mock runner")
        return execution

    def get(self, execution_id: int):
        return next((e for e in store.executions if e["id"] == execution_id), None)

    def list_for_product(self, product_id: int):
        return [e for e in store.executions if e["product_id"] == product_id]
