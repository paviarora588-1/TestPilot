from app.agents.testpilot_agent import TestPilotAgent
from app.services.rag_service import RagService
from app.services.store import store


class KnowledgeService:
    def __init__(self) -> None:
        self.agent = TestPilotAgent()
        self.rag = RagService()

    def list_sources(self, product_id: int):
        return [s for s in store.knowledge_sources if s["product_id"] == product_id]

    def create_source(self, product_id: int, payload: dict):
        source = {"id": store.next_id("knowledge_sources"), "product_id": product_id, "status": "Uploaded", **payload}
        store.knowledge_sources.append(source)
        store.add_history(product_id, "User", "knowledge uploaded", "KnowledgeSource", str(source["id"]), "Success", source["name"])
        return source

    def process(self, source_id: int):
        source = next((s for s in store.knowledge_sources if s["id"] == source_id), None)
        result = self.agent.process_knowledge(source["product_id"] if source else 1, source_id)
        if source:
            source["status"] = "Processed"
            self.rag.add_documents(source["product_id"], result["chunks"])
            store.add_history(source["product_id"], "TestPilot Agent", "knowledge processed", "KnowledgeSource", str(source_id), "Success", "Knowledge chunks and rules extracted")
        return result

    def summary(self, product_id: int):
        return {
            "product_id": product_id,
            "documents_uploaded": len(self.list_sources(product_id)),
            "chunks_created": 1842,
            "modules_detected": ["Role Catalog", "Access Request", "Generic Upload", "Hybrid Flow"],
            "business_rules": ["Search requires a business key", "Invalid uploads must block backend records"],
            "readiness": 92,
        }
