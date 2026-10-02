from copy import deepcopy
from datetime import UTC, datetime


class MockStore:
    """In-memory MVP data store used until SQL-backed repositories are wired."""

    def __init__(self) -> None:
        self.products = [
            {
                "id": 1,
                "name": "Enterprise Access Automation",
                "product_type": "Hybrid",
                "environment": "QA Regression",
                "entry_point": "https://qa.example-enterprise.com",
                "default_framework": "Hybrid Runner",
                "owner": "QA Manager",
                "description": "Generic cross-platform automation pilot.",
                "readiness_score": 86,
            }
        ]
        self.modules = [{"id": 1, "product_id": 1, "name": "Role Catalog", "description": "Role search and validation"}]
        self.features = [{"id": 1, "module_id": 1, "name": "Role Search", "description": "Search roles across UI and backend"}]
        self.knowledge_sources = [{"id": 1, "product_id": 1, "name": "Role Catalog User Guide.pdf", "source_type": "User Guide", "status": "Processed"}]
        self.objects = [
            {
                "id": 1,
                "product_id": 1,
                "object_name": "Role Name",
                "platform": "Web",
                "module": "Role Catalog",
                "feature": "Role Search",
                "screen": "Search Home",
                "object_type": "Input",
                "technical_path": "//input[@placeholder='Role Name']",
                "supported_actions": ["Enter Text", "Clear", "Verify Value"],
                "aliases": ["Role", "Business Role"],
                "status": "Active",
                "confidence": 96,
            },
            {
                "id": 2,
                "product_id": 1,
                "object_name": "Execute",
                "platform": "SAP GUI",
                "module": "SAP Validation",
                "feature": "Backend Search",
                "screen": "Toolbar",
                "object_type": "Button",
                "technical_path": "wnd[0]/tbar[1]/btn[8]",
                "supported_actions": ["Click", "Verify Enabled"],
                "aliases": ["Run", "Search"],
                "status": "Active",
                "confidence": 94,
            },
        ]
        self.test_cases = [
            {
                "id": 1,
                "product_id": 1,
                "external_id": "TC-101",
                "title": "Validate role search result",
                "module": "Role Catalog",
                "feature": "Role Search",
                "source": "Zephyr",
                "expected_result": "Matching role appears in result table.",
                "readiness": 91,
                "status": "Ready",
                "steps": ["Open Role Catalog", "Enter role name", "Click Search", "Verify result"],
            }
        ]
        self.mappings = []
        self.scripts = []
        self.executions = []
        self.auto_heal = []
        self.integrations = []
        self.settings = {
            "model": "GPT-4.1 Enterprise",
            "mock_ai": True,
            "require_script_approval": True,
            "require_auto_heal_approval": True,
            "enable_hybrid_runner": True,
        }
        self.history = []
        self.add_history(1, "System", "product created", "Product", "1", "Success", "Sample product initialized")

    def next_id(self, collection: str) -> int:
        values = getattr(self, collection)
        return max([item["id"] for item in values], default=0) + 1

    def add_history(self, product_id: int | None, actor: str, action: str, entity_type: str, entity_id: str, status: str, details: str, before: str = "", after: str = "") -> dict:
        event = {
            "id": self.next_id("history"),
            "product_id": product_id,
            "time": datetime.now(UTC).isoformat(),
            "actor": actor,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "status": status,
            "details": details,
            "before": before,
            "after": after,
        }
        self.history.append(event)
        return event

    def snapshot(self):
        return deepcopy(self)


store = MockStore()
