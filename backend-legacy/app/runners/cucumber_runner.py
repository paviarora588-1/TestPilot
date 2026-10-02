from app.runners.base import AutomationRunner, RunnerResult


class CucumberRunner(AutomationRunner):
    framework = "BDD - Cucumber"

    def run(self, payload: dict) -> RunnerResult:
        return self.mock_result()
