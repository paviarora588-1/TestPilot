from app.services.store import store


class IntegrationService:
    def list(self):
        return store.integrations

    def configure_zephyr(self, payload: dict):
        config = {"id": store.next_id("integrations"), "type": "zephyr", "enabled": True, "config": payload}
        store.integrations.append(config)
        return config

    def import_zephyr(self):
        store.add_history(1, "System", "integration sync completed", "Zephyr", "import", "Success", "Zephyr test cases imported")
        return {"imported": 42, "status": "Success"}

    def export_results(self):
        store.add_history(1, "System", "integration sync completed", "Zephyr", "export", "Success", "Execution results exported")
        return {"exported": 12, "status": "Success"}

    def create_defect(self, payload: dict):
        return {"defect_key": "QA-1001", "status": "Created", "payload": payload}
