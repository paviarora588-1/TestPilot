from app.runners.base import AutomationRunner, RunnerResult


class DesktopRunner(AutomationRunner):
    framework = "Desktop Automation"

    def run(self, payload: dict) -> RunnerResult:
        return self.mock_result()
