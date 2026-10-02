from app.services.vector_store import MockVectorStore


class RagService:
    def __init__(self) -> None:
        self.vector_store = MockVectorStore()

    def add_documents(self, product_id: int, chunks: list[dict]):
        return self.vector_store.add_documents(product_id, chunks)

    def search(self, product_id: int, query: str, top_k: int = 5):
        return self.vector_store.search(product_id, query, top_k)

    def delete_product_index(self, product_id: int):
        return self.vector_store.delete_product_index(product_id)
