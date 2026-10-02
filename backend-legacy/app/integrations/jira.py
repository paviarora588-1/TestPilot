class JiraClient:
    def create_defect(self, payload: dict):
        return {"defect_key": "QA-1001", "status": "Created", "payload": payload}
