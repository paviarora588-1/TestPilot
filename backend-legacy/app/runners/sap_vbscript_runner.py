from app.runners.base import AutomationRunner, RunnerResult


class SapVbScriptRunner(AutomationRunner):
    framework = "SAP GUI - VBScript"

    def run(self, payload: dict) -> RunnerResult:
        return self.mock_result()
