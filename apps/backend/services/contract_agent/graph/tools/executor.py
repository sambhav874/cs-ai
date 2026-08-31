"""Reusable read-only tool execution helpers for ContractSense ReAct steps."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from bson import ObjectId

from services.contract_agent.rag.evidence_service import EvidenceRetrievalService, expand_legal_queries

from ..state import AgentRunState, ToolCallRecord


def execute_mongo_read_tool(collection: Any, tool: ToolCallRecord, state: AgentRunState) -> Dict[str, Any]:
    """Execute scoped, read-only document tools against indexed contract content."""
    scoped_docs = _load_scoped_documents(collection, state)
    scoped_docs = _restrict_documents(scoped_docs, tool, state)
    if tool.name in {"list_documents", "fetch_documents"}:
        return {
            "summary": f"Loaded {len(scoped_docs)} scoped indexed document(s).",
            "documents": [
                {
                    "document_id": str(document["_id"]),
                    "filename": document.get("contract_name") or str(document["_id"]),
                    "chars": len(((document.get("index") or {}).get("content") or "")),
                    "indexed": bool(((document.get("index") or {}).get("content") or "").strip()),
                }
                for document in scoped_docs[:20]
            ],
        }
    if tool.name in {"read_document", "outline_document"}:
        document = _select_document(tool, state, scoped_docs)
        if not document:
            return {"summary": "No scoped document matched the requested document_id.", "documents": len(scoped_docs)}
        content = ((document.get("index") or {}).get("content") or "").strip()
        if tool.name == "outline_document":
            return _outline_document(collection, document, content)
        section_ref = str(tool.args.get("section_ref") or tool.args.get("section") or "")
        if section_ref:
            section_block = _find_section_block(document, content, section_ref)
            if section_block:
                return {
                    "summary": f"Read {document.get('contract_name') or document['_id']}, section {section_ref}.",
                    "document_id": str(document["_id"]),
                    "filename": document.get("contract_name") or str(document["_id"]),
                    "section": section_ref,
                    "snippet": section_block.get("snippet") or section_block.get("context", ""),
                    "page": section_block.get("page"),
                }
        include_full = bool(tool.args.get("include_full"))
        max_chars = min(max(_coerce_int(tool.args.get("max_chars"), 50000), 1000), 100000)
        return {
            "summary": f"Read {document.get('contract_name') or document['_id']}.",
            "document_id": str(document["_id"]),
            "filename": document.get("contract_name") or str(document["_id"]),
            "snippet": content[:12000] if not include_full else content[:max_chars],
            "content_scope": "full indexed document" if include_full else "document excerpt",
            "truncated": include_full and len(content) > max_chars,
        }
    if tool.name == "search_evidence":
        queries = _coerce_queries(tool.args.get("queries") or tool.args.get("query") or state.message)
        top_k = _coerce_int(tool.args.get("top_k"), 12)
        matches, backend, trace = _search_documents(
            collection,
            scoped_docs,
            queries,
            top_k=top_k,
            ai_provider=state.ai_provider,
            intent=str(tool.args.get("intent") or "") or None,
            must_contain=_coerce_list(tool.args.get("must_contain")),
            section_ref=str(tool.args.get("section_ref") or "") or None,
        )
        state.add_trace("retrieval_v2", **trace)

        # Apply semantic/hybrid score threshold to filter out weak matches
        matches = [m for m in matches if float(m.get("score") or 0.0) >= 40.0]

        results_block = _format_search_results_as_text(matches, scoped_docs, queries[0] if queries else state.message)

        return {
            "summary": f"Found {len(matches)} relevant section(s) matching your query.",
            "search_results": results_block,
            "match_count": len(matches),
            "retrieval_backend": backend,
            "trace": trace,
            "matches": matches,
            "rewritten_queries": queries,
            "rewritten_query": queries[0] if queries else "",
        }
    if tool.name == "find_in_document":
        document = _select_document(tool, state, scoped_docs)
        if not document:
            return {"summary": "No scoped document matched the requested document_id.", "matches": []}
        query = str(tool.args.get("term") or tool.args.get("query") or tool.args.get("find") or state.message or "")
        content = ((document.get("index") or {}).get("content") or "")
        matches = _find_in_document(document, content, query)
        reference = _extract_clause_reference(query)
        if reference and matches:
            summary = f"Found {len(matches)} scoped match(es) for section {reference}."
        elif reference:
            summary = f"No scoped match found for section {reference}."
        else:
            summary = f"Found {len(matches)} scoped text match(es)." if matches else "No scoped text match found."
        return {
            "summary": summary,
            "document_id": str(document["_id"]),
            "filename": document.get("contract_name") or str(document["_id"]),
            "matches": matches,
        }
    if tool.name == "get_kpi_context":
        contract_id, scoped_ids = _resolve_contract_ids_for_kpi(tool, state)
        metric_name = str(tool.args.get("metric_name") or "")
        query = str(tool.args.get("query") or state.message or "")
        return _get_kpi_context(collection, contract_id, metric_name=metric_name, query=query, scoped_ids=scoped_ids, state=state)
    if tool.name == "calculate_from_evidence":
        expression = str(tool.args.get("expression") or "")
        context = str(tool.args.get("context") or tool.args.get("text") or "")
        return _calculate_from_evidence(expression, context)
    if tool.name == "get_project_timeline":
        return _get_project_timeline(state)
    if tool.name == "read_project_concept":
        return _read_project_concept(state, str(tool.args.get("document_id") or ""))
    if tool.name == "read_project_events":
        return _read_project_events(state, tool.args.get("limit"))
    if tool.name == "read_schedules":
        return _read_schedules(
            state,
            view=str(tool.args.get("view") or "list"),
            schedule=str(tool.args.get("schedule") or ""),
            as_of=str(tool.args.get("as_of") or ""),
        )
    return {"summary": f"Read-only tool {tool.name} completed."}


def _load_scoped_documents(collection: Any, state: AgentRunState) -> List[Dict[str, Any]]:
    ids = list(dict.fromkeys([
        *(state.context.selected_document_ids or []),
        *(state.context.reference_contract_ids or []),
        *([state.context.contract_id] if state.context.contract_id else []),
    ]))
    lookup_ids: List[Any] = []
    for value in ids:
        if not value:
            continue
        text_value = str(value)
        if ObjectId.is_valid(text_value):
            lookup_ids.append(ObjectId(text_value))
        lookup_ids.append(text_value)
    if not lookup_ids:
        return []
    return list(collection.find(
        {
            "_id": {"$in": lookup_ids},
            "index.status": "success",
            "index.content": {"$type": "string", "$ne": ""},
        },
        {
            "_id": 1,
            "contract_name": 1,
            "index.content": 1,
            "index.vector_namespace": 1,
            "index.vector_backend": 1,
            "index.vector_count": 1,
            "index.vector_collection": 1,
            "index.segment_count": 1,
            "index.chunk_schema_version": 1,
        },
    ))


def _restrict_documents(documents: List[Dict[str, Any]], tool: ToolCallRecord, state: AgentRunState) -> List[Dict[str, Any]]:
    requested = set(_coerce_list(tool.args.get("document_ids")))
    for key in ("document_id", "contract_id"):
        requested_id = str(tool.args.get(key) or "").strip()
        if requested_id:
            requested.add(requested_id)
    if not requested:
        return documents

    # Resolve the model's friendly labels, but authorize against the route-built
    # scope. Filtering an unauthorized ID to an empty result would turn a denied
    # read into a harmless-looking no-match and make callers disagree about the
    # boundary.
    doc_index = {}
    attached = state.context.attached_documents or []
    for i, doc in enumerate(attached):
        doc_id = doc.get("document_id") or doc.get("id") or ""
        if doc_id:
            doc_index[f"doc-{i}"] = str(doc_id)
    selected_ids = state.context.selected_document_ids or []
    for i, doc_id in enumerate(selected_ids):
        if doc_id:
            doc_index.setdefault(f"doc-{i}", str(doc_id))

    scoped_ids = {
        str(doc_id).strip()
        for doc_id in [
            *(state.context.selected_document_ids or []),
            *(state.context.reference_contract_ids or []),
            *([state.context.contract_id] if state.context.contract_id else []),
        ]
        if str(doc_id).strip()
    }
    resolved_requested = set()
    for req in requested:
        req_str = str(req).strip()
        resolved_id = doc_index.get(req_str, req_str)
        if resolved_id not in scoped_ids:
            from services.contract_agent.graph.middleware import UnauthorizedAccessError

            raise UnauthorizedAccessError(f"Access to document {req_str} is out of scoped context!")
        resolved_requested.add(resolved_id)

    return [document for document in documents if str(document["_id"]) in resolved_requested]


def _select_document(
    tool: ToolCallRecord,
    state: AgentRunState,
    documents: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    requested_id = str(
        tool.args.get("document_id")
        or (state.context.displayed_document or {}).get("document_id")
        or state.context.contract_id
        or ""
    ).strip()

    # Map doc-i labels to actual document IDs using state
    doc_index = {}
    attached = state.context.attached_documents or []
    for i, doc in enumerate(attached):
        doc_id = doc.get("document_id") or doc.get("id") or ""
        if doc_id:
            doc_index[f"doc-{i}"] = str(doc_id)
    selected_ids = state.context.selected_document_ids or []
    for i, doc_id in enumerate(selected_ids):
        if doc_id:
            doc_index.setdefault(f"doc-{i}", str(doc_id))

    if requested_id in doc_index:
        requested_id = doc_index[requested_id]

    for document in documents:
        if str(document["_id"]) == requested_id:
            return document
    return documents[0] if documents else None


def _search_documents(
    collection: Any,
    documents: List[Dict[str, Any]],
    queries: Sequence[str],
    *,
    top_k: int = 12,
    ai_provider: Optional[str] = None,
    intent: Optional[str] = None,
    must_contain: Optional[Sequence[str]] = None,
    section_ref: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], str, Dict[str, Any]]:
    try:
        from core.config import settings

        retrieval_v2_enabled = bool(getattr(settings, "contract_rag_retrieval_v2", True))
    except Exception:
        retrieval_v2_enabled = True
    if not retrieval_v2_enabled:
        matches, backend = _legacy_search_documents(
            documents,
            queries,
            top_k=top_k,
            ai_provider=ai_provider,
            collection=collection,
        )
        return matches, backend, {
            "retrieval_v2": False,
            "backend": backend,
            "candidate_counts": {"selected": len(matches)},
        }
    return EvidenceRetrievalService().search_documents(
        collection,
        documents,
        queries,
        top_k=top_k,
        ai_provider=ai_provider,
        intent=intent,
        must_contain=must_contain or [],
        section_ref=section_ref,
    )


def _legacy_search_documents(
    documents: List[Dict[str, Any]],
    queries: Sequence[str],
    *,
    top_k: int,
    ai_provider: Optional[str],
    collection: Any,
) -> Tuple[List[Dict[str, Any]], str]:
    metadata_matches = _metadata_chunk_search(collection, documents, queries, top_k=top_k)
    if _metadata_matches_are_confident(metadata_matches):
        return metadata_matches, "hybrid"

    vector_matches = _vector_search_documents(documents, queries, top_k=top_k, ai_provider=ai_provider)
    if vector_matches and metadata_matches:
        merged = _dedupe_ranked_matches(
            [(float(match.get("score") or 0), match) for match in [*metadata_matches, *vector_matches]],
            top_k,
        )
        return merged, "hybrid"
    if metadata_matches:
        return metadata_matches, "hybrid"
    if vector_matches:
        return vector_matches, "vector"

    return _fallback_index_search(documents, queries, top_k=top_k), "fallback_index"


def _metadata_matches_are_confident(matches: List[Dict[str, Any]]) -> bool:
    if not matches:
        return False
    return max(float(match.get("score") or 0) for match in matches) >= 8.0


def _vector_search_documents(
    documents: List[Dict[str, Any]],
    queries: Sequence[str],
    *,
    top_k: int,
    ai_provider: Optional[str],
) -> List[Dict[str, Any]]:
    try:
        from services.contract_agent.rag import ContractRAGSystem
    except Exception:
        return []

    matches: List[Tuple[float, Dict[str, Any]]] = []
    candidate_k = max(top_k * 2, 8)
    for document in documents:
        namespace = str(((document.get("index") or {}).get("vector_namespace") or "")).strip()
        if not namespace:
            continue
        try:
            rag_system = ContractRAGSystem(ai_provider=ai_provider or "groq")
            vector_store = rag_system.load_existing_vector_store(namespace)
        except Exception:
            continue
        if not vector_store:
            continue
        for query_index, query in enumerate(queries):
            if not query.strip():
                continue
            try:
                docs = vector_store.as_retriever(
                    search_kwargs=_vector_search_kwargs(
                        document=document,
                        namespace=namespace,
                        k=candidate_k,
                    )
                ).invoke(query)
            except Exception:
                continue
            for rank, doc in enumerate(docs or []):
                match = _match_from_langchain_document(document, doc, backend="vector")
                if not match:
                    continue
                ranking_text = " ".join(
                    str(match.get(key) or "")
                    for key in ("snippet", "section", "filename")
                )
                lexical_score = _score_against_queries([query], ranking_text)
                score = lexical_score + (float(candidate_k - rank) * 0.15) + max(0.0, 1.0 - (query_index * 0.1))
                match["score"] = score
                matches.append((score, match))
    return _dedupe_ranked_matches(matches, top_k)


def _vector_search_kwargs(document: Dict[str, Any], namespace: str, k: int) -> Dict[str, Any]:
    doc_id = str(document.get("_id") or "").strip()
    pre_filter: Dict[str, Any] = {}
    if namespace:
        pre_filter["namespace"] = {"$eq": namespace}
    if doc_id:
        pre_filter["$or"] = [
            {"contract_id": {"$eq": doc_id}},
            {"document_id": {"$eq": doc_id}},
        ]
    search_kwargs: Dict[str, Any] = {"k": k}
    if pre_filter:
        search_kwargs["pre_filter"] = pre_filter
    return search_kwargs


def _metadata_chunk_search(
    collection: Any,
    documents: List[Dict[str, Any]],
    queries: Sequence[str],
    *,
    top_k: int,
) -> List[Dict[str, Any]]:
    vector_collection = _vector_collection(collection)
    if vector_collection is None:
        return []

    selectors: List[Dict[str, Any]] = []
    document_by_id = {str(document.get("_id")): document for document in documents}
    for document in documents:
        doc_id = str(document.get("_id") or "")
        index = document.get("index") or {}
        namespace = str(index.get("vector_namespace") or "").strip()
        if doc_id:
            selectors.extend([
                {"contract_id": doc_id},
                {"document_id": doc_id},
                {"metadata.contract_id": doc_id},
                {"metadata.document_id": doc_id},
            ])
        if namespace:
            selectors.extend([
                {"namespace": namespace},
                {"metadata.namespace": namespace},
            ])
    if not selectors:
        return []

    projection = {
        "text": 1,
        "page_content": 1,
        "content": 1,
        "contract_name": 1,
        "contract_id": 1,
        "document_id": 1,
        "project_id": 1,
        "namespace": 1,
        "segment_id": 1,
        "chunk_level": 1,
        "section_path": 1,
        "section_tags": 1,
        "value_types": 1,
        "page_number": 1,
        "page_start": 1,
        "page_end": 1,
        "char_start": 1,
        "char_end": 1,
        "metadata": 1,
    }
    try:
        raw_chunks = list(vector_collection.find({"$or": selectors}, projection))
    except Exception:
        return []

    scored: List[Tuple[float, Dict[str, Any]]] = []
    for raw in raw_chunks:
        match = _match_from_vector_chunk(raw, document_by_id=document_by_id, backend="hybrid")
        if not match:
            continue
        ranking_text = " ".join(
            str(match.get(key) or "")
            for key in ("snippet", "section", "filename")
        )
        score = _score_against_queries(queries, ranking_text)
        if score <= 0:
            continue
        match["score"] = float(score)
        scored.append((float(score), match))
    return _dedupe_ranked_matches(scored, top_k)


def _fallback_index_search(documents: List[Dict[str, Any]], queries: Sequence[str], *, top_k: int = 5) -> List[Dict[str, Any]]:
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for document in documents:
        for chunk in _evidence_chunks(document):
            score = _score_against_queries(queries, str(chunk.get("snippet") or ""))
            if score <= 0 and not _rank_tokens(" ".join(queries)) and chunk["snippet"].strip():
                score = 0.1
            if score <= 0:
                continue
            chunk["retrieval_backend"] = "fallback_index"
            chunk["score"] = float(score)
            scored.append((float(score), chunk))
    ranked = sorted(scored, key=lambda item: (-item[0], item[1].get("document_id", ""), item[1].get("start", 0)))
    return [item for _, item in ranked[: max(1, min(top_k, 20))]]


def _vector_collection(collection: Any) -> Any:
    database = getattr(collection, "database", None)
    if database is None:
        return None
    collection_name = "contract_vectors"
    database_name = None
    try:
        from core.config import settings
        collection_name = getattr(settings, "mongodb_collection_name", collection_name) or collection_name
        database_name = getattr(settings, "mongodb_db_name", None)
    except Exception:
        pass
    client = getattr(database, "client", None)
    if client is not None and database_name:
        try:
            return client[database_name][collection_name]
        except Exception:
            pass
    try:
        return database[collection_name]
    except Exception:
        return None


def _match_from_langchain_document(source_document: Dict[str, Any], doc: Any, *, backend: str) -> Optional[Dict[str, Any]]:
    metadata = dict(getattr(doc, "metadata", None) or {})
    text = str(getattr(doc, "page_content", "") or metadata.get("text") or metadata.get("content") or "").strip()
    if not text:
        return None
    source_doc_id = str(source_document.get("_id") or "")
    metadata_doc_id = str(metadata.get("document_id") or metadata.get("contract_id") or "").strip()
    if metadata_doc_id and metadata_doc_id != source_doc_id:
        return None
    doc_id = metadata_doc_id or source_doc_id
    segment_id = str(metadata.get("segment_id") or metadata.get("id") or "")
    evidence_id = _stable_evidence_id(doc_id, segment_id, text)
    page_start = metadata.get("page_start") or metadata.get("page_number")
    page_end = metadata.get("page_end")
    quote = text[:500]
    page = _estimate_page_for_quote(text, quote, page_start=page_start, page_end=page_end)
    return {
        "evidence_id": evidence_id,
        "segment_id": segment_id or evidence_id,
        "document_id": doc_id,
        "filename": metadata.get("contract_name") or source_document.get("contract_name") or doc_id,
        "page": page,
        "page_start": page_start,
        "page_end": page_end,
        "section": metadata.get("section_path"),
        "start": metadata.get("char_start") or 0,
        "end": metadata.get("char_end") or 0,
        "quote": quote,
        "context": text[:1800],
        "snippet": text[:1800],
        "retrieval_backend": backend,
    }


def _match_from_vector_chunk(
    raw: Dict[str, Any],
    *,
    document_by_id: Dict[str, Dict[str, Any]],
    backend: str,
) -> Optional[Dict[str, Any]]:
    text = str(_metadata_value(raw, "text") or _metadata_value(raw, "page_content") or _metadata_value(raw, "content") or "").strip()
    if not text:
        return None
    doc_id = str(_metadata_value(raw, "document_id") or _metadata_value(raw, "contract_id") or "")
    if doc_id and doc_id not in document_by_id:
        return None
    if not doc_id and len(document_by_id) == 1:
        doc_id = next(iter(document_by_id))
    if not doc_id:
        return None
    source_document = document_by_id.get(doc_id, {})
    filename = str(_metadata_value(raw, "contract_name") or source_document.get("contract_name") or doc_id)
    segment_id = str(_metadata_value(raw, "segment_id") or "")
    evidence_id = str(_metadata_value(raw, "evidence_id") or "") or _stable_evidence_id(doc_id, segment_id, text)
    page_start = _metadata_value(raw, "page_start") or _metadata_value(raw, "page_number")
    page_end = _metadata_value(raw, "page_end")
    quote = text[:500]
    page = _estimate_page_for_quote(text, quote, page_start=page_start, page_end=page_end)
    return {
        "evidence_id": evidence_id,
        "segment_id": segment_id or evidence_id,
        "document_id": doc_id,
        "filename": filename,
        "page": page,
        "page_start": page_start,
        "page_end": page_end,
        "section": _metadata_value(raw, "section_path"),
        "start": _metadata_value(raw, "char_start") or 0,
        "end": _metadata_value(raw, "char_end") or 0,
        "quote": quote,
        "context": text[:1800],
        "snippet": text[:1800],
        "retrieval_backend": backend,
        "chunk_level": _metadata_value(raw, "chunk_level"),
        "section_tags": _metadata_value(raw, "section_tags") or [],
        "value_types": _metadata_value(raw, "value_types") or [],
    }


def _metadata_value(raw: Dict[str, Any], key: str) -> Any:
    if key in raw and raw.get(key) not in (None, ""):
        return raw.get(key)
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    return metadata.get(key)


def _estimate_page_for_quote(
    text: str,
    quote: str,
    *,
    page_start: Optional[int],
    page_end: Optional[int],
) -> Optional[int]:
    """Estimate which page a quote falls on within a multi-page chunk.

    If the chunk spans only one page, or page bounds are unknown, returns page_start.
    Otherwise interpolates linearly: finds where the quote first appears in the chunk
    text and maps that character offset to the page range [page_start, page_end].
    """
    if not page_start:
        return page_start
    if not page_end or page_end <= page_start:
        return page_start
    if not text or not quote:
        return page_start

    cleaned_text = " ".join(text.split())
    cleaned_quote = " ".join(quote.split())

    # Try matching with a few different prefix lengths to be robust
    pos = -1
    for prefix_len in (120, 80, 40, 20):
        if len(cleaned_quote) >= prefix_len:
            pos = cleaned_text.find(cleaned_quote[:prefix_len])
            if pos >= 0:
                break
    
    if pos < 0:
        pos = cleaned_text.find(cleaned_quote)

    if pos < 0:
        # Fall back to end page if not found
        return page_end

    total_len = max(len(cleaned_text), 1)
    ratio = pos / total_len  # 0.0 = start of chunk, 1.0 = end of chunk
    page_span = page_end - page_start
    estimated = page_start + round(ratio * page_span)
    return max(page_start, min(page_end, estimated))


def _score_against_queries(queries: Sequence[str], text: str) -> float:
    text_lower = (text or "").lower()
    if not text_lower.strip():
        return 0.0
    score = 0.0
    for query in queries:
        query_lower = (query or "").lower().strip()
        if not query_lower:
            continue
        if query_lower in text_lower:
            score += 8.0
        query_tokens = set(_rank_tokens(query_lower))
        text_tokens = set(_rank_tokens(text_lower))
        if not query_tokens:
            continue
        overlap = query_tokens & text_tokens
        score += len(overlap) * 2.0
        score += len(overlap) / max(len(query_tokens), 1)
    return score


def _rank_tokens(text: str) -> List[str]:
    return [
        token
        for token in re.findall(r"[a-zA-Z0-9][a-zA-Z0-9_$%.-]{1,}", (text or "").lower())
        if token.strip()
    ]


def _dedupe_ranked_matches(scored: List[Tuple[float, Dict[str, Any]]], top_k: int) -> List[Dict[str, Any]]:
    seen: set[Tuple[str, str]] = set()
    ranked: List[Dict[str, Any]] = []
    for _score, match in sorted(scored, key=lambda item: (
        -item[0],
        str(item[1].get("document_id") or ""),
        int(item[1].get("start") or 0),
    )):
        key = (
            str(match.get("document_id") or ""),
            str(match.get("segment_id") or match.get("snippet") or "")[:180],
        )
        if key in seen:
            continue
        seen.add(key)
        ranked.append(match)
        if len(ranked) >= max(1, min(top_k, 20)):
            break
    return ranked


def _stable_evidence_id(doc_id: str, segment_id: str, text: str) -> str:
    if segment_id:
        return segment_id if str(segment_id).startswith(f"{doc_id}:") else f"{doc_id}:{segment_id}"
    evidence_hash = hashlib.sha1(f"{doc_id}:{text[:160]}".encode("utf-8")).hexdigest()[:14]
    return f"{doc_id}:{evidence_hash}"


def _section_leaf(section: str) -> str:
    parts = [part.strip() for part in str(section or "").split(">") if part.strip()]
    return parts[-1] if parts else str(section or "").strip()


def _heading_kind(section: str) -> str:
    first_word = _section_leaf(section).split(" ", 1)[0].lower().strip(":")
    if first_word in {"article", "section", "clause", "exhibit", "schedule", "appendix", "annex"}:
        return "exhibit" if first_word in {"schedule", "appendix", "annex"} else first_word
    return "heading"


def _outline_document(collection: Any, document: Dict[str, Any], content: str) -> Dict[str, Any]:
    text_outline = _extract_structural_headings(document, content)
    vector_outline = _outline_from_vector_chunks(collection, document)
    outline = _merge_outlines(text_outline, vector_outline)
    article_count = sum(1 for item in outline if item["kind"] == "article")
    section_count = sum(1 for item in outline if item["kind"] == "section")
    outline_text = "\n".join(item["heading"] for item in outline[:120])
    return {
        "summary": (
            f"Found {len(outline)} structural heading(s), including {article_count} article heading(s) and {section_count} section heading(s)."
            if outline else "No structural headings were detected in the scoped document."
        ),
        "document_id": str(document["_id"]),
        "filename": document.get("contract_name") or str(document["_id"]),
        "article_count": article_count,
        "section_count": section_count,
        "heading_count": len(outline),
        "headings": outline[:80],
        "outline_text": outline_text,
        "snippet": content[:1800],
    }


def _merge_outlines(*outline_groups: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()
    for outline in outline_groups:
        for item in outline:
            key = _outline_item_key(item)
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    merged.sort(key=lambda item: (
        int(item.get("page") or 10_000),
        int(item.get("start") or 0),
        str(item.get("heading") or ""),
    ))
    return merged


def _outline_item_key(item: Dict[str, Any]) -> Tuple[str, str]:
    kind = str(item.get("kind") or "heading").lower()
    heading = _section_leaf(str(item.get("heading") or item.get("title") or ""))
    normalized = re.sub(r"[^a-z0-9.]+", " ", heading.lower()).strip()
    return kind, normalized


def _extract_structural_headings(document: Dict[str, Any], content: str) -> List[Dict[str, Any]]:
    if not content.strip():
        return []
    headings: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str, str]] = set()
    patterns = [
        ("article", re.compile(r"(?im)^\s*(ARTICLE)\s+([IVXLCDM]+|\d+)\b\s*[:.\-]?\s*([^\n]{0,160})")),
        ("section", re.compile(r"(?im)^\s*(Section|Sec\.?)\s+(\d+(?:\.\d+)*[A-Za-z]?)\b\s*[:.\-]?\s*([^\n]{0,160})")),
        ("clause", re.compile(r"(?im)^\s*(Clause)\s+(\d+(?:\.\d+)*[A-Za-z]?)\b\s*[:.\-]?\s*([^\n]{0,160})")),
        ("exhibit", re.compile(r"(?im)^\s*(Exhibit|Schedule|Appendix|Annex)\s+([A-Z0-9\-]+)\b\s*[:.\-]?\s*([^\n]{0,160})")),
        ("heading", re.compile(r"(?m)^\s*((?:[A-Z][A-Z0-9&/(),.' -]{5,160})|(?:\d+(?:\.\d+)*\s+[A-Z][^\n]{3,140}))\s*$")),
    ]
    for kind, pattern in patterns:
        for match in pattern.finditer(content):
            raw_heading = re.sub(r"\s+", " ", match.group(0).strip())
            label = match.group(2).strip() if match.lastindex and match.lastindex >= 2 else ""
            title = re.sub(r"\s+", " ", (match.group(3) if match.lastindex and match.lastindex >= 3 else "").strip(" :-.\t"))
            if kind == "heading":
                title = raw_heading
            normalized_key = (kind, label.lower(), title.lower())
            if normalized_key in seen:
                continue
            seen.add(normalized_key)
            headings.append({
                "kind": kind,
                "label": label,
                "title": title,
                "heading": raw_heading,
                "document_id": str(document["_id"]),
                "filename": document.get("contract_name") or str(document["_id"]),
                "page": _page_near_offset(content, match.start()),
                "start": match.start(),
                "end": match.end(),
            })
    headings.sort(key=lambda item: int(item.get("start") or 0))
    return headings


def _outline_from_vector_chunks(collection: Any, document: Dict[str, Any]) -> List[Dict[str, Any]]:
    vector_collection = _vector_collection(collection)
    if vector_collection is None:
        return []
    doc_id = str(document.get("_id") or "")
    namespace = str(((document.get("index") or {}).get("vector_namespace") or "")).strip()
    selectors = [{"contract_id": doc_id}, {"document_id": doc_id}, {"metadata.contract_id": doc_id}, {"metadata.document_id": doc_id}]
    if namespace:
        selectors.extend([{"namespace": namespace}, {"metadata.namespace": namespace}])
    projection = {
        "contract_name": 1,
        "contract_id": 1,
        "document_id": 1,
        "namespace": 1,
        "segment_id": 1,
        "chunk_level": 1,
        "section_path": 1,
        "page_number": 1,
        "page_start": 1,
        "char_start": 1,
        "metadata": 1,
    }
    try:
        chunks = list(vector_collection.find({"$or": selectors}, projection))
    except Exception:
        return []
    seen: set[str] = set()
    outline: List[Dict[str, Any]] = []
    for raw in sorted(chunks, key=lambda item: (
        _metadata_value(item, "page_start") or _metadata_value(item, "page_number") or 10_000,
        _metadata_value(item, "char_start") or 0,
    )):
        section = str(_metadata_value(raw, "section_path") or "").strip()
        if not section or section in seen:
            continue
        seen.add(section)
        outline.append({
            "kind": _heading_kind(section),
            "label": "",
            "title": section,
            "heading": section,
            "document_id": str(_metadata_value(raw, "document_id") or _metadata_value(raw, "contract_id") or doc_id),
            "filename": str(_metadata_value(raw, "contract_name") or document.get("contract_name") or doc_id),
            "page": _metadata_value(raw, "page_start") or _metadata_value(raw, "page_number"),
            "segment_id": _metadata_value(raw, "segment_id"),
            "start": _metadata_value(raw, "char_start") or 0,
            "end": _metadata_value(raw, "char_end") or _metadata_value(raw, "char_start") or 0,
        })
    return outline




def _evidence_chunks(document: Dict[str, Any]) -> List[Dict[str, Any]]:
    content = ((document.get("index") or {}).get("content") or "")
    if not content.strip():
        return []
    doc_id = str(document["_id"])
    filename = document.get("contract_name") or doc_id
    chunks: List[Dict[str, Any]] = []
    for start, end, snippet in _chunk_text(content):
        evidence_hash = hashlib.sha1(f"{doc_id}:{start}:{end}:{snippet[:80]}".encode("utf-8")).hexdigest()[:14]
        chunks.append({
            "evidence_id": f"{doc_id}:{evidence_hash}",
            "segment_id": f"{doc_id}:{evidence_hash}",
            "document_id": doc_id,
            "filename": filename,
            "page": _page_near_offset(content, start),
            "section": None,
            "start": start,
            "end": end,
            "snippet": snippet.strip(),
        })
    return chunks


def _chunk_text(text: str, *, max_chars: int = 3000, overlap: int = 400) -> List[Tuple[int, int, str]]:
    chunks: List[Tuple[int, int, str]] = []
    clean_text = text or ""
    paragraph_matches = list(re.finditer(r"\S(?:.*?\S)?(?:\n\s*\n|$)", clean_text, flags=re.DOTALL))
    if paragraph_matches:
        for match in paragraph_matches:
            paragraph = match.group(0).strip()
            if len(paragraph) < 40:
                continue
            if len(paragraph) <= max_chars:
                chunks.append((match.start(), match.start() + len(match.group(0)), paragraph))
                continue
            chunks.extend(_window_text(clean_text, match.start(), match.end(), max_chars=max_chars, overlap=overlap))
    if not chunks:
        chunks = _window_text(clean_text, 0, len(clean_text), max_chars=max_chars, overlap=overlap)
    return chunks


def _window_text(text: str, start: int, end: int, *, max_chars: int, overlap: int) -> List[Tuple[int, int, str]]:
    chunks: List[Tuple[int, int, str]] = []
    cursor = start
    while cursor < end:
        chunk_end = min(end, cursor + max_chars)
        snippet = text[cursor:chunk_end].strip()
        if len(snippet) >= 40:
            chunks.append((cursor, chunk_end, snippet))
        if chunk_end >= end:
            break
        cursor = max(start, chunk_end - overlap)
    return chunks


def _page_near_offset(text: str, offset: int) -> Optional[int]:
    prefix = text[:offset]
    matches = list(re.finditer(r"(?:page|p\.)\s*(\d{1,4})", prefix[-3000:], flags=re.IGNORECASE))
    if not matches:
        return None
    try:
        return int(matches[-1].group(1))
    except (TypeError, ValueError):
        return None


def _find_in_document(document: Dict[str, Any], text: str, query: str) -> List[Dict[str, Any]]:
    reference = _extract_clause_reference(query)
    if reference:
        section_match = _find_section_block(document, text, reference)
        if section_match:
            return [section_match]
    return _find_in_text(document, text, query)


def _find_section_block(document: Dict[str, Any], text: str, reference: str) -> Optional[Dict[str, Any]]:
    if not text.strip():
        return None
    escaped = re.escape(reference)
    heading_pattern = re.compile(
        rf"(?im)^\s*(?:(?:section|sec\.?|clause|article)\s+)?{escaped}\b(?:\s*[:.)-]|\s+|$)"
    )
    inline_pattern = re.compile(
        rf"(?i)\b(?:section|sec\.?|clause|article)\s+{escaped}\b(?:\s*[:.)-]|\s+|$)"
    )
    match = heading_pattern.search(text) or inline_pattern.search(text)
    if not match:
        return None

    start = match.start()
    next_heading_start = _next_section_boundary(text, match.end(), reference)
    end = next_heading_start if next_heading_start is not None else min(len(text), start + 2200)
    if end <= start:
        end = min(len(text), start + 2200)
    snippet = text[start:end].strip()
    if len(snippet) > 2200:
        snippet = snippet[:2200].rstrip() + "\n... [section truncated]"
    return _evidence_payload(
        document,
        start=start,
        end=min(len(text), end),
        snippet=snippet,
        section=f"Section {reference}",
        quote=_first_line(snippet),
    )


def _find_in_text(document: Dict[str, Any], text: str, query: str) -> List[Dict[str, Any]]:
    needle = re.sub(r"\s+", " ", query or "").strip()
    if not needle:
        return []
    normalized_text = re.sub(r"\s+", " ", text or "")
    results: List[Dict[str, Any]] = []
    cursor = 0
    while cursor < len(normalized_text):
        position = normalized_text.lower().find(needle.lower(), cursor)
        if position < 0:
            break
        context = normalized_text[max(0, position - 360):position + len(needle) + 520]
        results.append(
            _evidence_payload(
                document,
                start=position,
                end=position + len(needle),
                snippet=context,
                section=None,
                quote=normalized_text[position:position + len(needle)],
            )
        )
        cursor = position + 1
    return results[:8]  # return up to 8 matches


def _extract_clause_reference(query: str) -> Optional[str]:
    normalized = str(query or "").strip()
    article_match = re.search(r"\barticle\s+([0-9]{1,3}(?!\.)|[ivxlcdm]+)\b", normalized, flags=re.IGNORECASE)
    if article_match:
        value = article_match.group(1)
        if value.isdigit():
            return _int_to_roman(int(value))
        return value.upper()
    patterns = [
        r"\b(?:section|sec\.?|clause|article)\s+([0-9]+(?:\.[0-9]+)+(?:[a-z])?)\b",
        r"\b([0-9]+(?:\.[0-9]+)+(?:[a-z])?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _next_section_boundary(text: str, search_from: int, reference: str) -> Optional[int]:
    heading_pattern = re.compile(
        r"(?im)^\s*(?:(?:section|sec\.?|clause)\s+([0-9]+(?:\.[0-9]+)+(?:[a-z])?)|article\s+([ivxlcdm]+|\d+))\b(?:\s*[:.)-]|\s+|$)"
    )
    for match in heading_pattern.finditer(text, search_from):
        candidate = match.group(1) or match.group(2) or ""
        if candidate.startswith(f"{reference}."):
            continue
        return match.start()
    return None


def _evidence_payload(
    document: Dict[str, Any],
    *,
    start: int,
    end: int,
    snippet: str,
    section: Optional[str],
    quote: str,
) -> Dict[str, Any]:
    doc_id = str(document["_id"])
    filename = document.get("contract_name") or doc_id
    evidence_hash = hashlib.sha1(f"{doc_id}:{start}:{end}:{snippet[:80]}".encode("utf-8")).hexdigest()[:14]
    return {
        "evidence_id": f"{doc_id}:{evidence_hash}",
        "segment_id": f"{doc_id}:{evidence_hash}",
        "document_id": doc_id,
        "filename": filename,
        "page": _page_near_offset(((document.get("index") or {}).get("content") or ""), start),
        "section": section,
        "start": start,
        "end": end,
        "quote": quote.strip(),
        "context": snippet.strip(),
        "snippet": snippet.strip(),
    }


def _first_line(text: str) -> str:
    for line in (text or "").splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned[:300]
    return ""


def _coerce_list(value: Any) -> List[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)] if str(value).strip() else []


def _coerce_queries(value: Any) -> List[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, dict):
        for key in ("queries", "rewritten_queries", "query"):
            if key in value:
                return _coerce_queries(value[key])
        return []
    if isinstance(value, list):
        return _expand_retrieval_queries(str(item).strip() for item in value if str(item).strip())
    text_value = str(value).strip()
    return _expand_retrieval_queries([text_value]) if text_value else []


def _expand_retrieval_queries(queries: Sequence[str]) -> List[str]:
    expanded: List[str] = []
    for query in queries:
        query = str(query or "").strip()
        if not query:
            continue
        expanded.append(query)
        expanded.extend(_formal_reference_query_variants(query))
    return expand_legal_queries(item for item in expanded if item.strip())[:12]


def _formal_reference_query_variants(query: str) -> List[str]:
    variants: List[str] = []
    for match in re.finditer(r"\b(article)\s+([0-9]{1,3}(?!\.)|[ivxlcdm]+)\b", query, flags=re.IGNORECASE):
        raw_value = match.group(2)
        roman = _int_to_roman(int(raw_value)) if raw_value.isdigit() else raw_value.upper()
        number = int(raw_value) if raw_value.isdigit() else _roman_to_int(raw_value)
        if roman:
            variants.extend([
                f"ARTICLE {roman}",
                f"Article {roman}",
            ])
        if number:
            variants.extend([
                f"Article {number}",
                f"article {number}",
            ])
    return variants


def _int_to_roman(value: int) -> str:
    if value <= 0 or value > 3999:
        return ""
    numerals = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ]
    result = []
    remaining = value
    for amount, numeral in numerals:
        while remaining >= amount:
            result.append(numeral)
            remaining -= amount
    return "".join(result)


def _roman_to_int(value: str) -> int:
    values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    total = 0
    previous = 0
    for char in reversed(str(value or "").upper()):
        current = values.get(char, 0)
        if current < previous:
            total -= current
        else:
            total += current
            previous = current
    return total


def _format_search_results_as_text(matches: List[Dict[str, Any]], documents: List[Dict[str, Any]], query: str) -> str:
    if not matches:
        return f"No contract sections matched the query \"{query}\"."

    lines: List[str] = []
    for index, match in enumerate(matches, start=1):
        doc_id = str(match.get("document_id") or "")
        doc_name = match.get("filename") or ""
        if not doc_name and doc_id:
            for doc in documents:
                if str(doc.get("_id")) == doc_id:
                    doc_name = doc.get("contract_name") or str(doc.get("_id"))
                    break
            if not doc_name:
                doc_name = doc_id
        section = match.get("section") or ""
        page = match.get("page")
        evidence_id = match.get("evidence_id") or match.get("segment_id") or ""
        quote = str(match.get("quote") or "").strip()
        text = str(match.get("context") or match.get("snippet") or quote or "").strip()
        score = match.get("score")

        lines.append(f"[{index}] {doc_name}" + (f", {section}" if section else "") + (f", p.{page}" if page else ""))
        if evidence_id:
            lines.append(f"    Evidence ID: {evidence_id}")
        if score not in (None, ""):
            lines.append(f"    Score: {score}")
        if quote:
            lines.append(f"    Quote: {quote[:700]}")
        if text and text != quote:
            lines.append(f"    Context: {text[:1400]}")
        elif text:
            lines.append(f"    Context: {text[:900]}")
        lines.append("")

    return "\n".join(lines).strip()


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# ── KPI context & calculation helpers ──────────────────────────────────────


def _resolve_contract_ids_for_kpi(tool: ToolCallRecord, state: AgentRunState) -> Tuple[Optional[str], List[str]]:
    """Resolve single or multiple contract_ids from tool args and agent run state context."""
    doc_index: Dict[str, str] = {}
    attached = state.context.attached_documents or []
    for i, doc in enumerate(attached):
        doc_id = doc.get("document_id") or doc.get("id") or ""
        if doc_id:
            doc_index[f"doc-{i}"] = str(doc_id)
    selected_ids = state.context.selected_document_ids or []
    for i, doc_id in enumerate(selected_ids):
        if doc_id:
            doc_index.setdefault(f"doc-{i}", str(doc_id))

    requested_id = str(tool.args.get("contract_id") or tool.args.get("document_id") or "").strip()
    if requested_id in doc_index:
        requested_id = doc_index[requested_id]

    all_scoped_ids: List[str] = []
    for sid in (state.context.selected_document_ids or []):
        if sid and str(sid) not in all_scoped_ids:
            all_scoped_ids.append(str(sid))
    for doc in (state.context.attached_documents or []):
        did = doc.get("document_id") or doc.get("id")
        if did and str(did) not in all_scoped_ids:
            all_scoped_ids.append(str(did))
    if state.context.contract_id and str(state.context.contract_id) not in all_scoped_ids:
        all_scoped_ids.append(str(state.context.contract_id))

    primary_id = (
        requested_id
        or (str(state.context.contract_id) if state.context.contract_id else None)
        or ((state.context.displayed_document or {}).get("document_id"))
        or (all_scoped_ids[0] if all_scoped_ids else None)
    )

    return primary_id, all_scoped_ids


def _get_project_timeline(state: AgentRunState) -> Dict[str, Any]:
    """Fetch the chronological project document history from project memory."""
    project_id = state.context.project_id
    if not project_id:
        return {"summary": "No project is in scope for this conversation.", "snippet": ""}

    try:
        from core.database import db as core_db
        from services.project_memory import ProjectMemoryManager

        manager = ProjectMemoryManager(core_db)
        # The complete document index plus any human notes. Per-document
        # overviews are deliberately not included — the agent fetches one by id
        # with read_concept when it needs the detail.
        context_text = manager.build_memory_context(project_id)
        if not context_text:
            context_text = manager.build_project_context_for_agent(project_id, state.message or "")
        return {
            "summary": "Retrieved chronological project document history.",
            "snippet": context_text,
        }
    except Exception as exc:
        return {"summary": f"Project timeline lookup failed: {str(exc)[:300]}", "snippet": ""}


def _read_project_concept(state: AgentRunState, document_id: str) -> Dict[str, Any]:
    """Fetch one document's full project-memory overview by id."""
    project_id = state.context.project_id
    if not project_id:
        return {"summary": "No project is in scope for this conversation.", "snippet": ""}
    if not document_id:
        return {"summary": "A document_id from the project index is required.", "snippet": ""}

    try:
        from core.database import db as core_db
        from services.project_memory import ProjectMemoryManager

        # project_id comes from the authorized scope, never from the model, so
        # a document id belonging to another project simply finds nothing.
        concept = ProjectMemoryManager(core_db).read_concept(project_id, document_id)
        if not concept:
            return {
                "summary": f"No project-memory overview for document {document_id} in this project.",
                "snippet": "",
            }
        return {"summary": f"Retrieved project-memory overview for {document_id}.", "snippet": concept}
    except Exception as exc:
        return {"summary": f"Project concept lookup failed: {str(exc)[:300]}", "snippet": ""}


def _read_project_events(state: AgentRunState, limit: Any = None) -> Dict[str, Any]:
    """Fetch the recent project event log."""
    project_id = state.context.project_id
    if not project_id:
        return {"summary": "No project is in scope for this conversation.", "snippet": ""}

    try:
        from core.database import db as core_db
        from services.project_memory import ProjectMemoryManager

        try:
            resolved_limit = max(1, min(int(limit or 20), 100))
        except (TypeError, ValueError):
            resolved_limit = 20

        rendered = ProjectMemoryManager(core_db).render_events(project_id, limit=resolved_limit)
        return {"summary": "Retrieved recent project events.", "snippet": rendered}
    except Exception as exc:
        return {"summary": f"Project event lookup failed: {str(exc)[:300]}", "snippet": ""}


def _read_schedules(
    state: AgentRunState,
    *,
    view: str = "list",
    schedule: str = "",
    as_of: str = "",
) -> Dict[str, Any]:
    """Read the project's tracked rate schedules and their history.

    This is the one piece of project knowledge that is structured, ordered in
    time, and spans documents. Without it the agent can only reach rate changes
    as the prose summaries in project memory — which say a card moved 3% but
    cannot say what it costs now, because a summary describes the movement
    between two versions rather than the values in either.
    """
    project_id = state.context.project_id
    if not project_id:
        return {"summary": "No project is in scope for this conversation.", "snippet": ""}

    scoped_ids = [
        str(doc_id) for doc_id in (state.context.selected_document_ids or []) if doc_id
    ]
    if not scoped_ids:
        return {"summary": "No documents are in scope for this conversation.", "snippet": ""}

    try:
        from services.schedule_registry import find_schedule, project_schedules, schedule_table

        lookup_ids: List[Any] = []
        for value in scoped_ids:
            if ObjectId.is_valid(value):
                lookup_ids.append(ObjectId(value))
            lookup_ids.append(value)

        # Authorized against the route-built scope, never a project-wide read:
        # the same boundary every other read tool honours.
        lineages, documents = project_schedules(
            project_id,
            contract_query={"_id": {"$in": lookup_ids}},
            links=_schedule_links_for_project(project_id),
        )
    except Exception as exc:
        return {"summary": f"Schedule lookup failed: {str(exc)[:300]}", "snippet": ""}

    if not lineages:
        return {
            "summary": "No tracked rate schedules were found in this project.",
            "snippet": (
                "No tables in this project are classified as a trackable schedule. "
                "That means either the documents hold no rate tables, or their "
                "tables are labelled as something other than a schedule."
            ),
        }

    selected_view = (view or "list").strip().lower()
    if selected_view not in {"list", "history", "values"}:
        selected_view = "list"

    if selected_view == "list":
        return {
            "summary": f"Found {len(lineages)} tracked schedule(s) in this project.",
            "snippet": _render_schedule_list(lineages),
        }

    match, candidates = find_schedule(lineages, schedule)
    if match is None:
        return {
            "summary": (
                f'Could not tell which schedule "{schedule}" means.'
                if schedule else "No schedule was named."
            ),
            # Deliberately not a best guess. Quoting the wrong rate card reads
            # exactly like quoting the right one.
            "snippet": _render_schedule_candidates(candidates),
        }

    if selected_view == "history":
        return {
            "summary": f'History for "{match.get("caption")}" — {match.get("version_count")} version(s).',
            "snippet": _render_schedule_history(match),
        }

    table = schedule_table(match, documents, as_of=as_of.strip() or None)
    if table is None:
        return {
            "summary": f'No version of "{match.get("caption")}" was in effect then.',
            "snippet": (
                f"The earliest version of this schedule takes effect "
                f"{match['versions'][0].get('effective_date') or 'at an unstated date'}."
            ),
        }
    when = "current" if table["is_latest"] else f"in effect on {as_of}"
    return {
        "summary": f'"{table["caption"]}" — {when}, from {table["contract_name"]}.',
        "snippet": _render_schedule_values(table),
    }


def _schedule_links_for_project(project_id: str) -> Dict[str, str]:
    """Schedule links a person has confirmed or rejected.

    Read here rather than passed in so the agent sees the same resolved links
    the Schedules tab does — an unresolved link the user has since confirmed
    would otherwise show the agent a lineage break that no longer exists.
    """
    try:
        from core.database import db as core_db

        return {
            record["link"]: record["decision"]
            for record in core_db["schedule_links"].find(
                {"project_id": ObjectId(project_id)}, {"link": 1, "decision": 1}
            )
            if record.get("link") and record.get("decision")
        }
    except Exception:
        return {}


def _render_schedule_candidates(candidates: List[Dict[str, Any]]) -> str:
    """The schedules that could have been meant, each distinguishable.

    Two schedules in one project can carry the same caption — a rate card that
    appears in two documents without a confirmed link between them is exactly
    that case, and it is common. Listing captions alone would offer the user a
    choice between two identical strings, so each candidate carries what tells
    it apart and the id to pass straight back.
    """
    if not candidates:
        return "This project has no tracked schedules to choose from."
    lines = ["Ask which of these is meant, then call again with schedule set to its id:"]
    for lineage in candidates[:10]:
        lines.append(
            f'- "{lineage.get("caption")}" · {lineage.get("version_count")} version(s) · '
            f'latest effective {lineage.get("latest_effective_date") or "unstated"} · '
            f'id: {lineage.get("signature")}'
        )
    if len(candidates) > 10:
        lines.append(f"- and {len(candidates) - 10} more; use view=list to see them all")
    return "\n".join(lines)


def _render_schedule_list(lineages: List[Dict[str, Any]]) -> str:
    lines = ["Tracked rate schedules in this project:"]
    for lineage in lineages:
        total = lineage.get("total_pct")
        movement = f"{total:+.2f}% overall" if total is not None else "no measured movement"
        flag = " · NEEDS REVIEW: a version could not be linked with certainty" if lineage.get("needs_review") else ""
        lines.append(
            f'- "{lineage.get("caption")}" · {lineage.get("table_type") or "unlabelled"} · '
            f'{lineage.get("version_count")} version(s) · {movement} · '
            f'latest effective {lineage.get("latest_effective_date") or "unstated"} · '
            f'id: {lineage.get("signature")}{flag}'
        )
    lines.append(
        "Call this tool again with view=values to read the rates themselves, "
        "or view=history for what changed between versions."
    )
    return "\n".join(lines)


def _render_schedule_history(lineage: Dict[str, Any]) -> str:
    lines = [
        f'"{lineage.get("caption")}" ({lineage.get("table_type") or "unlabelled"}), oldest first:'
    ]
    for version in lineage.get("versions") or []:
        effective = version.get("effective_date") or "date not stated"
        lines.append(
            f'- {effective} · {version.get("contract_name")} · '
            f'{version.get("summary") or "first version recorded"}'
        )
        for change in (version.get("changes") or [])[:8]:
            lines.append(
                f'    · {change.get("row")}: {change.get("old") or "—"} → {change.get("new") or "—"}'
            )
        remaining = version.get("changes_truncated") or 0
        if remaining:
            lines.append(f"    · and {remaining} more change(s) not listed")
    total = lineage.get("total_pct")
    if total is not None:
        lines.append(
            f"Compounded across every version: {total:+.2f}%. "
            "Successive uplifts multiply rather than add, so this is not the sum "
            "of the individual percentages."
        )
    return "\n".join(lines)


def _render_schedule_values(table: Dict[str, Any]) -> str:
    header = (
        f'"{table["caption"]}" as stated in {table["contract_name"]}'
        f' (effective {table.get("effective_date") or "date not stated"}'
        f', page {table.get("page") or "unknown"}):'
    )
    footer = (
        "" if table["is_latest"]
        else "\nThis is a superseded version. A later revision of this schedule exists."
    )
    return f'{header}\n{table.get("body") or "(no rows)"}{footer}'


def _get_kpi_context(
    collection: Any,
    contract_id: Optional[str],
    *,
    metric_name: str = "",
    query: str = "",
    scoped_ids: Optional[List[str]] = None,
    state: Optional[AgentRunState] = None,
) -> Dict[str, Any]:
    """Fetch KPI/SLA records for the given contract(s), filtering by metric name or query."""
    target_ids = list(dict.fromkeys([id_val for id_val in ([contract_id] + (scoped_ids or [])) if id_val]))
    if not target_ids:
        return {"summary": "No contract_id available for KPI lookup.", "kpis": [], "count": 0}

    try:
        from services.kpi_manager import ContractKPIManager
        manager = ContractKPIManager()
        kpis: List[Dict[str, Any]] = []
        for tid in target_ids:
            found = manager.list_contract_kpis(tid)
            if found:
                kpis.extend(found)

        # Deduplicate by kpi_id
        seen_kpi_ids = set()
        deduped_kpis = []
        for kpi in kpis:
            kid = kpi.get("kpi_id") or kpi.get("id")
            if kid and kid not in seen_kpi_ids:
                seen_kpi_ids.add(kid)
                deduped_kpis.append(kpi)
            elif not kid:
                deduped_kpis.append(kpi)
        kpis = deduped_kpis

        # Auto-extraction fallback if 0 KPIs currently in database
        if not kpis and collection is not None:
            from bson import ObjectId
            for tid in target_ids:
                doc = None
                if ObjectId.is_valid(tid):
                    doc = collection.find_one({"_id": ObjectId(tid)})
                if not doc:
                    doc = collection.find_one({"_id": tid})
                if doc:
                    user_id = state.user_id if state and hasattr(state, "user_id") else "agent"
                    res = manager.extract_for_contract(contract_doc=doc, user_id=user_id, replace_drafts=False)
                    extracted = res.get("kpis") or []
                    if extracted:
                        kpis.extend(extracted)
    except Exception as exc:
        return {"summary": f"KPI lookup failed: {str(exc)[:300]}", "kpis": [], "count": 0}

    if not kpis:
        return {
            "summary": "No KPI/SLA records found for the scoped contract(s).",
            "kpis": [],
            "count": 0,
        }

    search_terms = _extract_search_terms(metric_name or query)
    if search_terms:
        kpis = _rank_kpis_by_query(kpis, search_terms)

    summary_data = ContractKPIManager().summarize_kpis(kpis) if hasattr(ContractKPIManager, "summarize_kpis") else {}

    compact_kpis = []
    for kpi in kpis[:30]:
        quote_val = kpi.get("quote") or kpi.get("source_clause") or kpi.get("definition")
        if isinstance(quote_val, dict):
            quote_val = quote_val.get("quote") or quote_val.get("text") or quote_val.get("clause_text") or ""
        if not quote_val and isinstance(kpi.get("identity"), dict):
            sc = kpi["identity"].get("source_clause")
            if isinstance(sc, dict):
                quote_val = sc.get("quote") or sc.get("text") or ""
            elif isinstance(sc, str):
                quote_val = sc
        if not isinstance(quote_val, str):
            quote_val = str(quote_val or "")

        page_val = (
            kpi.get("page_start")
            or kpi.get("page_number")
            or kpi.get("page")
        )
        if page_val is None and isinstance(kpi.get("identity"), dict):
            sc = kpi["identity"].get("source_clause")
            if isinstance(sc, dict):
                page_val = sc.get("page_start") or sc.get("page_number") or sc.get("page")

        cid = (
            kpi.get("contract_id")
            or (kpi.get("identity", {}).get("contract_id") if isinstance(kpi.get("identity"), dict) else None)
            or contract_id
        )
        fname = (
            kpi.get("contract_name")
            or kpi.get("filename")
            or (kpi.get("identity", {}).get("contract_name") if isinstance(kpi.get("identity"), dict) else None)
        )

        compact_kpis.append({
            "kpi_id": kpi.get("kpi_id"),
            "name": kpi.get("name") or (kpi.get("identity", {}).get("name") if isinstance(kpi.get("identity"), dict) else ""),
            "kpi_type": kpi.get("kpi_type") or (kpi.get("identity", {}).get("kpi_type") if isinstance(kpi.get("identity"), dict) else ""),
            "value": kpi.get("value") or kpi.get("target_value"),
            "unit": kpi.get("unit"),
            "status": kpi.get("status"),
            "threshold": kpi.get("threshold") or kpi.get("threshold_min"),
            "breach_state": kpi.get("breach_state"),
            "actual_value": kpi.get("actual_value"),
            "page": page_val,
            "page_start": page_val,
            "contract_id": cid,
            "filename": fname,
            "quote": quote_val[:500],
            "text": quote_val[:500],
            "citation": kpi.get("citation"),
        })

    return {
        "summary": (
            f"Found {len(kpis)} KPI/SLA record(s) matching the query. "
            f"Key categories: {summary_data.get('by_type', {})}. "
            f"Status breakdown: {summary_data.get('by_status', {})}."
            if summary_data
            else f"Found {len(kpis)} KPI/SLA record(s) for the scoped contract."
        ),
        "count": len(kpis),
        "kpis": compact_kpis,
        "summary_data": summary_data,
    }


def _extract_search_terms(text: str) -> List[str]:
    cleaned = re.sub(r"[^\w\s]", " ", text.lower()).strip()
    tokens = [token for token in cleaned.split() if len(token) > 2 and token not in {
        "the", "and", "for", "what", "are", "is", "this", "that", "with", "from",
        "get", "find", "show", "list", "kpi", "sla", "give", "tell", "please",
    }]
    return tokens[:8]


def _rank_kpis_by_query(kpis: List[Dict[str, Any]], terms: List[str]) -> List[Dict[str, Any]]:
    scored = []
    for kpi in kpis:
        searchable = " ".join(str(kpi.get(key) or "").lower() for key in ("name", "kpi_type", "definition", "quote"))
        score = sum(2.0 for term in terms if term in kpi.get("name", "").lower())
        score += sum(1.0 for term in terms if term in searchable)
        scored.append((score, kpi))
    scored.sort(key=lambda item: -item[0])
    return [item[1] for item in scored]


def _calculate_from_evidence(expression: str, context: str) -> Dict[str, Any]:
    """Safely evaluate an arithmetic expression grounded in evidence values."""
    if not expression.strip():
        return {"summary": "No expression provided for calculation.", "result": None}

    numbers = re.findall(r"\b\d[\d,]*(?:\.\d+)?\b", f"{expression} {context}")
    values = []
    for match in numbers:
        try:
            values.append(float(match.replace(",", "")))
        except ValueError:
            continue

    sanitized = expression.strip()
    sanitized = re.sub(r"\b\d[\d,]*(?:\.\d+)?\b", lambda m: m.group(0).replace(",", ""), sanitized)

    allowed_chars = set("0123456789.+-*/() eExXpiPIAR_")
    if not all(c in allowed_chars for c in sanitized.replace(" ", "")):
        return {
            "summary": "Expression contains unsupported characters. Only basic arithmetic (+, -, *, /, parentheses) and numeric values from evidence are allowed.",
            "result": None,
            "value_count": len(values),
        }

    result = None
    error = None
    try:
        from services.kpi_schema import evaluate_safe_formula
        result = float(evaluate_safe_formula(sanitized))
    except Exception as exc:
        error = str(exc)[:200]

    return {
        "summary": (
            f"Computed result: {result} from {len(values)} source value(s)."
            if result is not None
            else f"Could not evaluate expression: {error}"
        ),
        "result": result,
        "source_values": values,
        "value_count": len(values),
        "expression": sanitized,
        "error": error,
    }


def execute_correct_fact(
    state: AgentRunState,
    fact_id: str = "",
    corrected_value: str = "",
    reason: str = "",
    *,
    fact_description: str = "",
    tags: Optional[Sequence[str]] = None,
    origin: str = "user",
) -> Dict[str, Any]:
    """Execute fact correction directly against project memory."""
    project_id = state.context.project_id
    if not project_id:
        return {"summary": "No project is in scope for this conversation.", "error": "No project in scope."}

    corrected_text = (corrected_value or "").strip()
    if not corrected_text:
        return {"summary": "A correction needs replacement text.", "error": "Missing replacement text."}

    try:
        from core.database import db as core_db
        from services.project_memory import ProjectMemoryManager

        manager = ProjectMemoryManager(core_db)
        all_facts = manager.list_facts(project_id, include_superseded=True)
        target_fact = None
        if fact_id:
            target_fact = next((f for f in all_facts if str(f.get("fact_id") or "") == fact_id.strip()), None)
        if not target_fact and fact_description:
            desc = fact_description.strip().lower()
            target_fact = next((f for f in all_facts if desc in str(f.get("text") or "").lower() and not f.get("superseded_by")), None)
        if not target_fact and not fact_id and not fact_description:
            active_facts = [f for f in all_facts if not f.get("superseded_by")]
            if len(active_facts) == 1:
                target_fact = active_facts[0]

        if not target_fact:
            return {
                "summary": f"Could not find existing project fact to correct (fact_id='{fact_id}', description='{fact_description}').",
                "error": "Fact not found",
            }

        resolved_origin = origin if origin in {"contract", "user"} else "user"
        contract_id = state.context.contract_id or ""
        sources = [{"contract_id": contract_id, "quote": reason}] if resolved_origin == "contract" and contract_id and reason else []

        replacement = manager.remember_fact(
            project_id=project_id,
            text=corrected_text,
            sources=sources,
            tags=list(tags) if tags else [],
            origin=resolved_origin,
        )
        manager.supersede_fact(project_id, target_fact["fact_id"], replacement["fact_id"])

        return {
            "summary": f"Corrected project fact. Superseded '{target_fact.get('text')}' with '{replacement.get('text')}'.",
            "fact_id": replacement["fact_id"],
            "superseded_fact_id": target_fact["fact_id"],
            "text": replacement["text"],
            "replacement": replacement,
        }
    except Exception as exc:
        return {"summary": f"Failed to correct fact: {str(exc)[:300]}", "error": str(exc)}

