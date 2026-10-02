from app.services.store import store


class HistoryService:
    def list_for_product(self, product_id: int):
        return [event for event in store.history if event.get("product_id") in (None, product_id)]

    def create(self, payload: dict):
        return store.add_history(
            payload.get("product_id"),
            payload.get("actor", "User"),
            payload.get("action", "custom event"),
            payload.get("entity_type", "Unknown"),
            str(payload.get("entity_id", "")),
            payload.get("status", "Success"),
            payload.get("details", ""),
            payload.get("before", ""),
            payload.get("after", ""),
        )
