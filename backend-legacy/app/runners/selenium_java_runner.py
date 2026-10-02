from app.runners.base import AutomationRunner, RunnerResult


class SeleniumJavaRunner(AutomationRunner):
    framework = "Web - Selenium Java"

    def run(self, payload: dict) -> RunnerResult:
        return self.mock_result()
