"""BM25-based vector store — no external dependencies required.

Replaces the original MockVectorStore with a real ranked-retrieval engine.
BM25 (Okapi BM25) gives strong keyword-based relevance without needing
embedding models or GPU resources, making it ideal for local-AI deployments.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any


def _tokenize(text: str) -> list[str]:
    """Lower-case, split on non-alphanumeric, drop tokens shorter than 3 chars."""
    return [t for t in re.findall(r"[a-z0-9_/.-]+", text.lower()) if len(t) >= 3]


class SmartVectorStore:
    """BM25 (Okapi) ranked retrieval with in-memory inverted index.

    Parameters follow the canonical BM25 recommendations:
        k1 = 1.5  (term-frequency saturation)
        b  = 0.75 (document-length normalisation)
    """

    BM25_K1 = 1.5
    BM25_B = 0.75

    def __init__(self) -> None:
        # Per-product: raw document chunks
        self._docs:    dict[int, list[dict[str, Any]]] = {}
        # Per-product: term-frequency counters, one per doc
        self._tf:      dict[int, list[Counter]] = {}
        # Per-product: document-frequency counter (term → #docs containing term)
        self._df:      dict[int, Counter] = {}
        # Per-product: average doc length (in tokens)
        self._avg_len: dict[int, float] = {}

    # ------------------------------------------------------------------ #
    #  Write                                                               #
    # ------------------------------------------------------------------ #

    def add_documents(self, product_id: int, chunks: list[dict[str, Any]]) -> dict[str, Any]:
        docs    = self._docs.setdefault(product_id, [])
        tf_list = self._tf.setdefault(product_id, [])
        df      = self._df.setdefault(product_id, Counter())

        for chunk in chunks:
            content = chunk.get("content", "") if isinstance(chunk, dict) else str(chunk)
            tokens  = _tokenize(content)
            tf      = Counter(tokens)
            tf_list.append(tf)
            for term in set(tokens):
                df[term] += 1
            docs.append(chunk if isinstance(chunk, dict) else {"content": str(chunk)})

        lengths = [sum(tf.values()) for tf in tf_list]
        self._avg_len[product_id] = sum(lengths) / max(len(lengths), 1)
        return {"product_id": product_id, "added": len(chunks), "total": len(docs)}

    def delete_product_index(self, product_id: int) -> dict[str, Any]:
        self._docs.pop(product_id, None)
        self._tf.pop(product_id, None)
        self._df.pop(product_id, None)
        self._avg_len.pop(product_id, None)
        return {"deleted": True}

    # ------------------------------------------------------------------ #
    #  Read                                                                #
    # ------------------------------------------------------------------ #

    def search(self, product_id: int, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        docs    = self._docs.get(product_id, [])
        tf_list = self._tf.get(product_id, [])
        df      = self._df.get(product_id, Counter())
        avg_len = self._avg_len.get(product_id, 1.0)
        n_docs  = len(docs)

        if not docs:
            return []

        query_tokens = _tokenize(query)
        if not query_tokens:
            return docs[:top_k]

        scores: list[tuple[float, int]] = []
        for i, (doc_tf) in enumerate(tf_list):
            doc_len = sum(doc_tf.values()) or 1
            score   = 0.0
            for term in query_tokens:
                if term not in doc_tf:
                    continue
                n_containing = df.get(term, 0)
                # Smoothed IDF (avoids log(0); adds 1 to numerator and denominator)
                idf  = math.log((n_docs - n_containing + 0.5) / (n_containing + 0.5) + 1.0)
                freq = doc_tf[term]
                # BM25 term-frequency normalisation
                tf_norm = freq * (self.BM25_K1 + 1) / (
                    freq + self.BM25_K1 * (1 - self.BM25_B + self.BM25_B * doc_len / avg_len)
                )
                score += idf * tf_norm
            scores.append((score, i))

        scores.sort(reverse=True)

        results = []
        for score, idx in scores[:top_k]:
            entry = dict(docs[idx])
            entry["score"] = round(score, 4)
            results.append(entry)

        # If nothing scored > 0 (query terms not in corpus), fall back to first N
        return results if any(r["score"] > 0 for r in results) else docs[:top_k]

    # ------------------------------------------------------------------ #
    #  Diagnostics                                                         #
    # ------------------------------------------------------------------ #

    def stats(self, product_id: int) -> dict[str, Any]:
        return {
            "product_id": product_id,
            "document_count": len(self._docs.get(product_id, [])),
            "unique_terms": len(self._df.get(product_id, {})),
            "avg_doc_length_tokens": round(self._avg_len.get(product_id, 0), 1),
        }


# Keep the old name as an alias so existing imports don't break
MockVectorStore = SmartVectorStore
