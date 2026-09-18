"""Optional VoyageAI cross-encoder reranker for second-stage retrieval ranking.

Config-gated via VOYAGE_RERANK_ENABLED. When disabled, the system uses
heuristic chunk-level + section-ref + value-type boosting (unchanged).

Uses the same direct-HTTP pattern as kpi_manager.py for consistency.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

from core.config import settings

from .evidence_service import EvidenceHit

logger = logging.getLogger(__name__)

# Internal re-export so callers can simply `from .reranker import get_reranker`.
__all__ = ["VoyageReranker", "get_reranker", "rerank_evidence_hits"]


class VoyageReranker:
    """Light wrapper around VoyageAI rerank-2-lite API.

    Truncation is enabled by default to keep requests within Voyage's token
    budget (~8K tokens per document).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        top_k: Optional[int] = None,
    ):
        self.api_key = api_key or settings.voyageai_api_key
        self.model = model or getattr(settings, "voyage_rerank_model", "rerank-2-lite")
        self.top_k = top_k or getattr(settings, "voyage_rerank_final_k", 8)
        self._session: Optional[requests.Session] = None

    @property
    def session(self) -> requests.Session:
        if self._session is None:
            self._session = requests.Session()
            self._session.headers.update(
                {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                }
            )
        return self._session

    def rerank(
        self, query: str, documents: List[str], top_k: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        """Re-rank documents against a query.

        Returns a list of (original_index, relevance_score) tuples sorted by
        descending relevance.
        """
        if not documents:
            return []

        k = min(top_k or self.top_k, len(documents))
        payload: Dict[str, Any] = {
            "query": query,
            "documents": documents,
            "model": self.model,
            "top_k": k,
            "truncation": True,
        }
        resp = self.session.post(
            "https://api.voyageai.com/v1/rerank",
            json=payload,
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        return [
            (int(item["index"]), float(item["relevance_score"]))
            for item in data
            if "index" in item and "relevance_score" in item
        ]

    def rerank_hits(
        self, query: str, hits: List[EvidenceHit], top_k: Optional[int] = None
    ) -> List[EvidenceHit]:
        """Re-rank EvidenceHit objects.

        Each hit is represented by its section path + quote/context text,
        truncated to keep within Voyage's token limits.
        """
        if not hits:
            return hits

        texts: List[str] = []
        for hit in hits:
            section = hit.section_path or ""
            body = hit.quote or hit.context or ""
            # Voyage reranker truncates at ~8K tokens per doc; we keep it shorter.
            texts.append(f"{section} {body}"[:2800])

        try:
            ranked = self.rerank(query, texts, top_k=top_k)
        except Exception:
            logger.warning("VoyageAI reranker call failed; falling back to heuristic ranking.")
            return hits

        reordered: List[EvidenceHit] = []
        for idx, score in ranked:
            if idx < len(hits):
                hits[idx].scores["rerank_score"] = score
                reordered.append(hits[idx])
        return reordered


# ---------------------------------------------------------------------------
# Module-level singleton — created on first use.
# ---------------------------------------------------------------------------
_reranker: Optional[VoyageReranker] = None


def get_reranker() -> VoyageReranker:
    global _reranker
    if _reranker is None:
        _reranker = VoyageReranker()
    return _reranker


# ---------------------------------------------------------------------------
# Convenience function for use in retrieval pipelines.
# ---------------------------------------------------------------------------
def rerank_evidence_hits(
    query: str,
    hits: List[EvidenceHit],
    *,
    top_k: Optional[int] = None,
) -> List[EvidenceHit]:
    """Re-rank if the reranker is enabled; otherwise return hits unchanged."""
    if not getattr(settings, "voyage_rerank_enabled", False):
        return hits
    return get_reranker().rerank_hits(query, hits, top_k=top_k)
