from app.services.store import store


class TestCaseService:
    def list(self, product_id: int):
        return [tc for tc in store.test_cases if tc["product_id"] == product_id]

    def create(self, product_id: int, payload: dict):
        test_case = {"id": store.next_id("test_cases"), "product_id": product_id, "status": "Imported", "readiness": 0, **payload}
        store.test_cases.append(test_case)
        store.add_history(product_id, "User", "test case imported", "TestCase", str(test_case["id"]), "Success", test_case["title"])
        return test_case

    def import_cases(self, payload: dict):
        return {"imported": 3, "source": payload.get("source", "Zephyr"), "status": "Success"}

    def get(self, test_case_id: int):
        return next((tc for tc in store.test_cases if tc["id"] == test_case_id), None)
