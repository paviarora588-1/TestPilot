from app.runners.base import AutomationRunner, RunnerResult


class HybridRunner(AutomationRunner):
    framework = "Hybrid Runner"

    def run(self, payload: dict) -> RunnerResult:
        return self.mock_result()
