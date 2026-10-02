from app.runners.base import AutomationRunner, RunnerResult


class PlaywrightRunner(AutomationRunner):
    framework = "Web - Playwright"

    def run(self, payload: dict) -> RunnerResult:
        return self.mock_result()
