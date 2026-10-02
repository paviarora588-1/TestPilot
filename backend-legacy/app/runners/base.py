from abc import ABC, abstractmethod


class RunnerResult(dict):
    pass


class AutomationRunner(ABC):
    framework: str

    @abstractmethod
    def run(self, payload: dict) -> RunnerResult:
        raise NotImplementedError

    def mock_result(self, status: str = "Passed") -> RunnerResult:
        return RunnerResult(
            status=status,
            logs=[f"{self.framework} runner initialized", "Resolved objects", "Captured evidence placeholder"],
            duration_seconds=42,
            step_results=[
                {"step_order": 1, "action": "open product", "status": "Passed", "duration_seconds": 4},
                {"step_order": 2, "action": "execute mapped action", "status": status, "duration_seconds": 8},
            ],
            evidence_path=f"evidence/{self.framework.lower().replace(' ', '-')}/latest",
        )
