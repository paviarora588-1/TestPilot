from app.services.store import store


class ProductService:
    def list(self):
        return store.products

    def create(self, payload: dict):
        product = {"id": store.next_id("products"), "readiness_score": 0, **payload}
        store.products.append(product)
        store.add_history(product["id"], "User", "product created", "Product", str(product["id"]), "Success", f"Product {product['name']} created")
        return product

    def get(self, product_id: int):
        return next((p for p in store.products if p["id"] == product_id), None)

    def update(self, product_id: int, payload: dict):
        product = self.get(product_id)
        if product:
            product.update(payload)
            store.add_history(product_id, "User", "product updated", "Product", str(product_id), "Success", "Product settings updated")
        return product

    def delete(self, product_id: int):
        before = len(store.products)
        store.products = [p for p in store.products if p["id"] != product_id]
        store.add_history(product_id, "User", "product deleted", "Product", str(product_id), "Success", "Product deleted")
        return {"deleted": before != len(store.products)}

    def modules(self, product_id: int):
        return [m for m in store.modules if m["product_id"] == product_id]

    def create_module(self, product_id: int, payload: dict):
        module = {"id": store.next_id("modules"), "product_id": product_id, **payload}
        store.modules.append(module)
        return module

    def features(self, module_id: int):
        return [f for f in store.features if f["module_id"] == module_id]

    def create_feature(self, module_id: int, payload: dict):
        feature = {"id": store.next_id("features"), "module_id": module_id, **payload}
        store.features.append(feature)
        return feature
