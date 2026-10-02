from app.services.store import store


def record_history(product_id: int | None, actor: str, action: str, entity_type: str, entity_id: str, status: str, details: str):
    return store.add_history(product_id, actor, action, entity_type, entity_id, status, details)
