"""Reusable read-only tool execution helpers for ContractSense ReAct steps."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from bson import ObjectId

from services.contract_agent.rag.evidence_service import EvidenceRetrievalService

from ..state import AgentRunState, ToolCallRecord


def execute_mongo_read_tool(collection: Any, tool: ToolCallRecord, state: AgentRunState) -> Dict[str, Any]:
    """Execute scoped, read-only document tools against indexed contract content."""
    scoped_docs = _load_scoped_documents(collection, state)
    scoped_docs = _restrict_documents(scoped_docs, tool)
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
        return {
            "summary": f"Read {document.get('contract_name') or document['_id']}.",
            "document_id": str(document["_id"]),
            "filename": document.get("contract_name") or str(document["_id"]),
            "snippet": content[:1800],
        }
    if tool.name == "search_evidence":
        queries = _coerce_queries(tool.args.get("queries") or tool.args.get("query") or state.message)
        matches, backend, trace = _search_documents(
            collection,
            scoped_docs,
            queries,
            top_k=_coerce_int(tool.args.get("top_k"), 5),
            ai_provider=state.ai_provider,
            intent=str(tool.args.get("intent") or "") or None,
            must_contain=_coerce_list(tool.args.get("must_contain")),
            section_ref=str(tool.args.get("section_ref") or "") or None,
        )
        state.add_trace("retrieval_v2", **trace)
        return {
            "summary": (
                f"Found {len(matches)} scoped evidence candidate(s) using {backend} retrieval. "
                "Call read_evidence with the selected evidence_id values before finalizing exact contract citations."
            ),
            "rewritten_query": queries[0] if queries else "",
            "rewritten_queries": queries,
            "retrieval_backend": backend,
            "requires_read_evidence": bool(matches),
            "trace": trace,
            "matches": matches,
        }
    if tool.name == "read_evidence":
        evidence_ids = _coerce_list(tool.args.get("evidence_ids") or tool.args.get("segment_ids"))
        if not evidence_ids:
            return {"summary": "No evidence_ids were provided to read_evidence.", "matches": []}
        matches = _read_evidence_ids(collection, scoped_docs, evidence_ids)
        missing = [evidence_id for evidence_id in evidence_ids if evidence_id not in {match.get("evidence_id") for match in matches}]
        return {
            "summary": f"Read {len(matches)} scoped evidence snippet(s)." + (f" Missing {len(missing)}." if missing else ""),
            "matches": matches,
            "missing_evidence_ids": missing,
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
        return {"summary": "KPI context is available from visible state.", "visible_state": state.context.visible_state}
    if tool.name == "calculate_from_evidence":
        text = " ".join(
            str(tool.args.get(key) or "")
            for key in ("expression", "context", "text")
        )
        values = [float(match.replace(",", "")) for match in re.findall(r"\b\d[\d,]*(?:\.\d+)?\b", text)]
        return {"summary": f"Found {len(values)} numeric value(s) for calculation.", "values": values, "count": len(values)}
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


def _restrict_documents(documents: List[Dict[str, Any]], tool: ToolCallRecord) -> List[Dict[str, Any]]:
    requested = set(_coerce_list(tool.args.get("document_ids")))
    requested_id = str(tool.args.get("document_id") or "")
    if requested_id:
        requested.add(requested_id)
    if not requested:
        return documents
    return [document for document in documents if str(document["_id"]) in requested]


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
    )
    for document in documents:
        if str(document["_id"]) == requested_id:
            return document
    return documents[0] if documents else None


def _search_documents(
    collection: Any,
    documents: List[Dict[str, Any]],
    queries: Sequence[str],
    *,
    top_k: int = 5,
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
    return {
        "evidence_id": evidence_id,
        "segment_id": segment_id or evidence_id,
        "document_id": doc_id,
        "filename": metadata.get("contract_name") or source_document.get("contract_name") or doc_id,
        "page": metadata.get("page_start") or metadata.get("page_number"),
        "section": metadata.get("section_path"),
        "start": metadata.get("char_start") or 0,
        "end": metadata.get("char_end") or 0,
        "quote": _first_line(text),
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
    return {
        "evidence_id": evidence_id,
        "segment_id": segment_id or evidence_id,
        "document_id": doc_id,
        "filename": filename,
        "page": _metadata_value(raw, "page_start") or _metadata_value(raw, "page_number"),
        "section": _metadata_value(raw, "section_path"),
        "start": _metadata_value(raw, "char_start") or 0,
        "end": _metadata_value(raw, "char_end") or 0,
        "quote": _first_line(text),
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


def _read_evidence_ids(collection: Any, documents: List[Dict[str, Any]], evidence_ids: List[str]) -> List[Dict[str, Any]]:
    return EvidenceRetrievalService().read_documents(collection, documents, evidence_ids)


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


def _chunk_text(text: str, *, max_chars: int = 900, overlap: int = 160) -> List[Tuple[int, int, str]]:
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
    position = normalized_text.lower().find(needle.lower())
    if position < 0:
        return []
    context = normalized_text[max(0, position - 360):position + len(needle) + 520]
    return [
        _evidence_payload(
            document,
            start=position,
            end=position + len(needle),
            snippet=context,
            section=None,
            quote=normalized_text[position:position + len(needle)],
        )
    ]


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
    return list(dict.fromkeys(item for item in expanded if item.strip()))[:10]


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


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
