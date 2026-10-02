from app.services.store import store


class ObjectRepositoryService:
    def list(self, product_id: int):
        return [o for o in store.objects if o["product_id"] == product_id]

    def create(self, product_id: int, payload: dict):
        obj = {"id": store.next_id("objects"), "product_id": product_id, "status": "Active", **payload}
        store.objects.append(obj)
        store.add_history(product_id, "User", "object added", "ObjectRepository", str(obj["id"]), "Success", obj["object_name"])
        return obj

    def update(self, object_id: int, payload: dict):
        obj = next((o for o in store.objects if o["id"] == object_id), None)
        if obj:
            before = obj.get("technical_path", "")
            obj.update(payload)
            after = obj.get("technical_path", "")
            store.add_history(obj["product_id"], "User", "object updated", "ObjectRepository", str(object_id), "Success", "Object repository updated", before, after)
        return obj

    def delete(self, object_id: int):
        store.objects = [o for o in store.objects if o["id"] != object_id]
        return {"deleted": True}

    def verify(self, object_id: int):
        obj = next((o for o in store.objects if o["id"] == object_id), None)
        if obj:
            obj["status"] = "Active"
            obj["confidence"] = max(obj.get("confidence", 0), 90)
        return {"object_id": object_id, "verified": True, "confidence": obj.get("confidence", 90) if obj else 0}
