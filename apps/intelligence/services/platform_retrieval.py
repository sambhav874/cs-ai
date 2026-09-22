"""Retrieval over an org's linked contracts, for the lifecycle API.

draftLegal ranked clauses with pgvector (`searchClauses` in apps/api), which
cannot run on MongoDB, so since the database move its Q&A and search have
been keyword-only. This serves the same question -- "which passages of this
org's contracts answer X?" -- from ContractSense's pipeline instead: the
hybrid evidence retrieval its own agent uses (`search_evidence`), over the
analysis copies linked by services/platform_contracts.

Hits come back keyed by platformContractId, so the API can map them onto its
own contracts without knowing this tier's ids.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence

from core.platform_identity import derive_object_id

# ContractSense's agent treats hybrid scores below this as noise (see
# graph/tools/executor.py, search_evidence); the same bar applies here.
MIN_SCORE = 40.0
# Without a vector index (a copy still ingesting, or no embedding key) the
# service falls back to lexical ranking, whose scores sit far lower on the
# same scale -- the right passage scored ~24 in testing. An absolute bar
# would then drop everything, so the fallback keeps hits relative to the best.
FALLBACK_RELATIVE_CUT = 0.6


def _default_search():
    from services.contract_agent.graph.tools.executor import _search_documents
    return _search_documents


def search_platform_contracts(
    org_id: str,
    query: str,
    *,
    limit: int,
    contracts,
    platform_contract_ids: Optional[Sequence[str]] = None,
    search: Optional[Callable[..., Any]] = None,
) -> List[Dict[str, Any]]:
    """Ranked passages from the org's analysed copies, best first."""
    team_oid = derive_object_id("org", org_id)
    scope: Dict[str, Any] = {
        # Only the org's own copies: the team id is derived from the org id,
        # the same derivation the identity adapter uses.
        "ownerType": "team",
        "ownerId": team_oid,
        "platformDeleted": {"$ne": True},
        # Not yet ingested means nothing to search, not an error.
        "index.content": {"$nin": [None, ""]},
    }
    scope["platformContractId"] = (
        {"$in": list(platform_contract_ids)} if platform_contract_ids else {"$type": "string"}
    )
    documents = list(contracts.find(scope))
    if not documents:
        return []

    run = search or _default_search()
    matches, backend, _trace = run(contracts, documents, [query], top_k=limit)
    if str(backend).startswith("fallback"):
        best = max((float(m.get("score") or 0.0) for m in matches), default=0.0)
        bar = best * FALLBACK_RELATIVE_CUT
    else:
        bar = MIN_SCORE

    platform_id_of = {str(d["_id"]): d["platformContractId"] for d in documents}
    title_of = {str(d["_id"]): d.get("contract_name") for d in documents}
    hits: List[Dict[str, Any]] = []
    for m in matches:
        score = float(m.get("score") or 0.0)
        doc_id = str(m.get("document_id") or "")
        if score < bar or doc_id not in platform_id_of:
            continue
        hits.append({
            "platformContractId": platform_id_of[doc_id],
            "title": title_of.get(doc_id),
            "passageId": m.get("segment_id") or m.get("evidence_id") or "",
            "section": m.get("section_path") or m.get("section"),
            "page": m.get("page_start") or m.get("page"),
            "quote": m.get("quote") or m.get("snippet") or "",
            "context": m.get("context") or "",
            "score": score,
            "backend": backend,
        })
    hits.sort(key=lambda h: h["score"], reverse=True)
    return hits[:limit]
