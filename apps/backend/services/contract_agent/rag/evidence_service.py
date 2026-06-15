"""Shared evidence retrieval and exact-span helpers for contract tools.

The graph ReAct tools and the older RAG agent both need the same evidence
contract: stable IDs, legal-aware fallback segmentation, compact quotes, and
metadata that is precise enough for citation validation.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
import hashlib
import re
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from core.config import settings
from utils.text_cleanup import clean_text_encoding

from .schemas import TextSegment
from .segmentation import DocumentSegmenter

# ---------------------------------------------------------------------------
# TTL retrieval cache — avoids re-running the full hybrid pipeline for
# identical (contract, query) pairs within a short window.
# ---------------------------------------------------------------------------
_RETRIEVAL_CACHE: OrderedDict[str, Tuple[List[EvidenceHit], float]] = OrderedDict()
_RETRIEVAL_CACHE_MAX = 256
_RETRIEVAL_CACHE_TTL_SECONDS = 300  # 5 minutes


def _retrieval_cache_key(contract_id: str, query: str) -> str:
    return hashlib.sha256(
        f"{contract_id}:{query.strip().lower()}".encode()
    ).hexdigest()


def _retrieval_cache_get(key: str) -> Optional[List[EvidenceHit]]:
    entry = _RETRIEVAL_CACHE.get(key)
    if entry:
        hits, timestamp = entry
        if time.time() - timestamp < _RETRIEVAL_CACHE_TTL_SECONDS:
            return hits
        del _RETRIEVAL_CACHE[key]
    return None


def _retrieval_cache_set(key: str, hits: List[EvidenceHit]) -> None:
    if len(_RETRIEVAL_CACHE) >= _RETRIEVAL_CACHE_MAX:
        _RETRIEVAL_CACHE.popitem(last=False)
    _RETRIEVAL_CACHE[key] = (hits, time.time())


def _retrieval_cache_clear() -> None:
    _RETRIEVAL_CACHE.clear()


STOP_WORDS = {
    "about",
    "after",
    "again",
    "against",
    "also",
    "are",
    "between",
    "but",
    "can",
    "contract",
    "contracts",
    "document",
    "documents",
    "does",
    "from",
    "have",
    "how",
    "into",
    "more",
    "must",
    "need",
    "not",
    "only",
    "other",
    "project",
    "review",
    "should",
    "show",
    "that",
    "the",
    "there",
    "these",
    "this",
    "things",
    "through",
    "what",
    "when",
    "where",
    "which",
    "with",
    "work",
    "would",
}


LEGAL_SYNONYMS = {
    "assignment": ["assign", "transfer"],
    "confidential": ["confidentiality", "non-disclosure", "disclose", "proprietary"],
    "deadline": ["within", "days", "due", "period", "no later", "schedule"],
    "liability": ["indemnity", "indemnification", "damages", "loss", "limitation"],
    "notice": ["notify", "notification", "written notice", "days"],
    "obligation": ["shall", "must", "required", "responsible", "covenant", "agree"],
    "payment": ["pay", "paid", "invoice", "fee", "fees", "price", "pricing", "compensation"],
    "rate": ["ratecard", "rate card", "rates", "pricing", "price", "fee", "fees"],
    "renewal": ["renew", "extension", "extend", "term"],
    "termination": ["terminate", "terminated", "default", "breach", "cure", "notice"],
}


@dataclass
class EvidenceHit:
    """Normalized internal evidence hit.

    Public tool outputs keep backward-compatible aliases such as `page`,
    `section`, `start`, `end`, `snippet`, and `context`.
    """

    evidence_id: str
    segment_id: str
    document_id: Optional[str]
    filename: Optional[str]
    quote: str
    context: str
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    section_path: Optional[str] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    context_before: str = ""
    context_after: str = ""
    chunk_level: Optional[str] = None
    retrieval_backend: str = "evidence_service"
    score: float = 0.0
    scores: Dict[str, float] = field(default_factory=dict)
    section_tags: List[str] = field(default_factory=list)
    value_types: List[str] = field(default_factory=list)
    requires_read: bool = False

    def key(self) -> Tuple[str, str]:
        stable_id = self.segment_id or self.evidence_id
        if stable_id:
            return (self.document_id or "", stable_id)
        digest = hashlib.sha1((self.quote or self.context or "").encode("utf-8")).hexdigest()[:14]
        return (self.document_id or "", digest)

    def to_dict(self) -> Dict[str, Any]:
        page = self.page_start
        return {
            "evidence_id": self.evidence_id,
            "segment_id": self.segment_id,
            "document_id": self.document_id,
            "filename": self.filename,
            "page": page,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "section": self.section_path,
            "section_path": self.section_path,
            "start": self.char_start or 0,
            "end": self.char_end or 0,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "quote": self.quote,
            "context": self.context,
            "context_before": self.context_before,
            "context_after": self.context_after,
            "snippet": self.context or self.quote,
            "retrieval_backend": self.retrieval_backend,
            "chunk_level": self.chunk_level,
            "section_tags": self.section_tags,
            "value_types": self.value_types,
            "score": round(float(self.score or 0.0), 4),
            "scores": {key: round(float(value), 6) for key, value in self.scores.items()},
            "requires_read": self.requires_read,
            "citation_ready": not self.requires_read,
        }


class EvidenceRetrievalService:
    """Hybrid, contract-aware evidence retrieval shared by tools and RAG."""

    def __init__(self, *, segmenter: Optional[DocumentSegmenter] = None):
        self.segmenter = segmenter or DocumentSegmenter()

    def search_documents(
        self,
        collection: Any,
        documents: Sequence[Dict[str, Any]],
        queries: Sequence[str],
        *,
        top_k: int = 5,
        ai_provider: Optional[str] = None,
        intent: Optional[str] = None,
        must_contain: Optional[Sequence[str]] = None,
        section_ref: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], str, Dict[str, Any]]:
        normalized_queries = normalize_queries(queries)
        normalized_must = normalize_queries(must_contain or [])
        normalized_section = normalize_section_ref(section_ref)
        resolved_intent = intent or infer_intent(" ".join(normalized_queries))

        # Check retrieval cache (per-contract + query)
        combined_query = " ".join(normalized_queries)
        doc_ids = "_".join(sorted(str(d.get("_id", "")) for d in documents))
        cache_key = _retrieval_cache_key(doc_ids, combined_query)
        cached = _retrieval_cache_get(cache_key)
        if cached is not None:
            return (
                [hit.to_dict() for hit in cached],
                "hybrid_v2",
                {
                    "retrieval_v2": True,
                    "backend": "hybrid_v2",
                    "backend_detail": "cache",
                    "intent": resolved_intent,
                    "candidate_counts": {"selected": len(cached)},
                    "cached": True,
                },
            )

        # Optional query decomposition — break compound questions into sub-queries
        decomposed_queries = normalized_queries
        decomposition_used = False
        if getattr(settings, "query_decomposition_enabled", False):
            from .query_decomposer import decompose_query, is_complex_query
            if is_complex_query(combined_query):
                decomposed = decompose_query(
                    combined_query,
                    provider=ai_provider or "groq",
                )
                if decomposed and decomposed != normalized_queries:
                    decomposed_queries = decomposed
                    decomposition_used = True

        candidate_k = max(top_k * 4, 20)
        # Use decomposed queries for metadata + vector + fallback searches
        search_queries = decomposed_queries if decomposition_used else normalized_queries
        metadata_hits = self._metadata_chunk_search(
            collection,
            documents,
            search_queries,
            candidate_k=candidate_k,
            intent=resolved_intent,
            must_contain=normalized_must,
            section_ref=normalized_section,
        )
        vector_hits = self._vector_search_documents(
            documents,
            search_queries,
            candidate_k=candidate_k,
            ai_provider=ai_provider,
            intent=resolved_intent,
            must_contain=normalized_must,
            section_ref=normalized_section,
        )
        fallback_hits = self._fallback_segment_search(
            documents,
            search_queries,
            candidate_k=candidate_k,
            intent=resolved_intent,
            must_contain=normalized_must,
            section_ref=normalized_section,
        )

        fused = self._fuse_ranked_hits(
            [
                (metadata_hits, 2.4, "metadata"),
                (vector_hits, 2.0, "vector"),
                (fallback_hits, 1.7, "legal_fallback"),
            ],
            top_k=top_k,
            queries=normalized_queries,
            intent=resolved_intent,
            must_contain=normalized_must,
            section_ref=normalized_section,
        )
        backend_parts = [
            name
            for name, hits in (
                ("metadata", metadata_hits),
                ("vector", vector_hits),
                ("legal_fallback", fallback_hits),
            )
            if hits
        ]
        backend_detail = "hybrid_v2" if len(backend_parts) > 1 else (backend_parts[0] if backend_parts else "legal_fallback")
        if len(backend_parts) > 1 or backend_detail == "metadata":
            backend = "hybrid"
        elif backend_detail == "legal_fallback":
            backend = "fallback_index"
        else:
            backend = backend_detail

        # Cache results for subsequent identical queries
        _retrieval_cache_set(cache_key, list(fused))

        trace = {
            "retrieval_v2": True,
            "backend": backend,
            "backend_detail": backend_detail,
            "intent": resolved_intent,
            "query_decomposition_used": decomposition_used,
            "decomposed_queries": decomposed_queries if decomposition_used else None,
            "reranker_used": bool(getattr(settings, "voyage_rerank_enabled", False)),
            "candidate_counts": {
                "metadata": len(metadata_hits),
                "vector": len(vector_hits),
                "legal_fallback": len(fallback_hits),
                "selected": len(fused),
            },
            "requires_read_evidence": bool(fused),
        }
        return [hit.to_dict() for hit in fused], backend, trace

    def read_documents(
        self,
        collection: Any,
        documents: Sequence[Dict[str, Any]],
        evidence_ids: Sequence[str],
    ) -> List[Dict[str, Any]]:
        wanted = [str(item) for item in evidence_ids if str(item).strip()]
        if not wanted:
            return []
        wanted_set = set(wanted)
        by_id: Dict[str, EvidenceHit] = {}

        for document in documents:
            for hit in self._legal_document_hits(document, requires_read=False):
                self._register_hit_aliases(by_id, hit)

        # Resolve remaining wanted IDs from executor evidence chunks
        still_missing = [e for e in wanted if e not in by_id]
        if still_missing:
            try:
                from services.contract_agent.graph.tools.executor import _evidence_chunks as _exec_chunks
            except Exception:
                _exec_chunks = None
            if _exec_chunks:
                for document in documents:
                    for chunk in _exec_chunks(document):
                        eid = str(chunk.get("evidence_id") or "")
                        if eid not in still_missing:
                            continue
                        snippet = str(chunk.get("snippet") or chunk.get("context") or chunk.get("quote") or "")
                        if not snippet.strip():
                            continue
                        hit = EvidenceHit(
                            evidence_id=eid,
                            segment_id=str(chunk.get("segment_id") or eid),
                            document_id=str(chunk.get("document_id") or document.get("_id", "")),
                            filename=str(chunk.get("filename") or document.get("contract_name") or ""),
                            quote=str(chunk.get("quote") or snippet[:200]),
                            context=snippet.strip(),
                            page_start=coerce_int(chunk.get("page")),
                            char_start=coerce_int(chunk.get("start")),
                            char_end=coerce_int(chunk.get("end")),
                            requires_read=False,
                        )
                        self._register_hit_aliases(by_id, hit)

        vector_collection = self._vector_collection(collection)
        if vector_collection is not None:
            selectors: List[Dict[str, Any]] = []
            for evidence_id in wanted:
                suffix = evidence_id.split(":", 1)[1] if ":" in evidence_id else evidence_id
                selectors.extend([
                    {"segment_id": evidence_id},
                    {"segment_id": suffix},
                    {"metadata.segment_id": evidence_id},
                    {"metadata.segment_id": suffix},
                    {"evidence_id": evidence_id},
                    {"metadata.evidence_id": evidence_id},
                ])
            try:
                raw_chunks = list(vector_collection.find({"$or": selectors}, None))
            except Exception:
                raw_chunks = []
            document_by_id = {str(document.get("_id")): document for document in documents}
            for raw in raw_chunks:
                hit = self._hit_from_vector_chunk(
                    raw,
                    document_by_id=document_by_id,
                    backend="metadata",
                    queries=wanted,
                    intent="fact",
                    must_contain=[],
                    section_ref=None,
                    requires_read=False,
                )
                if hit:
                    self._register_hit_aliases(by_id, hit)

        return [by_id[evidence_id].to_dict() for evidence_id in wanted if evidence_id in by_id]

    def search_segments(
        self,
        segments: Sequence[TextSegment],
        query: str,
        *,
        limit: int = 8,
        intent: Optional[str] = None,
        must_contain: Optional[Sequence[str]] = None,
        section_ref: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        queries = normalize_queries([query])
        normalized_must = normalize_queries(must_contain or [])
        normalized_section = normalize_section_ref(section_ref)
        resolved_intent = intent or infer_intent(query)
        hits: List[EvidenceHit] = []
        for segment in segments:
            if segment.type == "sentence" or not (segment.text or "").strip():
                continue
            hit = self._hit_from_segment(
                segment,
                queries=queries,
                intent=resolved_intent,
                must_contain=normalized_must,
                section_ref=normalized_section,
                requires_read=True,
            )
            if not hit or hit.score <= 0:
                continue
            hits.append(hit)
        ranked = self._rerank_hits(hits, queries=queries, intent=resolved_intent, must_contain=normalized_must, section_ref=normalized_section)
        return [hit.to_dict() for hit in ranked[: max(1, min(limit, 20))]]

    def read_segments(self, segments: Sequence[TextSegment], segment_ids: Sequence[str]) -> List[Dict[str, Any]]:
        by_id: Dict[str, TextSegment] = {}
        for segment in segments:
            by_id[segment.id] = segment
            if segment.contract_id:
                by_id[f"{segment.contract_id}:{segment.id}"] = segment
        hits: List[Dict[str, Any]] = []
        for segment_id in segment_ids:
            segment = by_id.get(str(segment_id))
            if not segment:
                continue
            hit = self._hit_from_segment(segment, queries=[], intent="fact", requires_read=False)
            if hit:
                hits.append(hit.to_dict())
        return hits

    def _metadata_chunk_search(
        self,
        collection: Any,
        documents: Sequence[Dict[str, Any]],
        queries: Sequence[str],
        *,
        candidate_k: int,
        intent: str,
        must_contain: Sequence[str],
        section_ref: Optional[str],
    ) -> List[EvidenceHit]:
        vector_collection = self._vector_collection(collection)
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
            "namespace": 1,
            "segment_id": 1,
            "evidence_id": 1,
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

        hits: List[EvidenceHit] = []
        for raw in raw_chunks:
            hit = self._hit_from_vector_chunk(
                raw,
                document_by_id=document_by_id,
                backend="metadata",
                queries=queries,
                intent=intent,
                must_contain=must_contain,
                section_ref=section_ref,
                requires_read=True,
            )
            if not hit or hit.score <= 0:
                continue
            hits.append(hit)
        return self._rerank_hits(hits, queries=queries, intent=intent, must_contain=must_contain, section_ref=section_ref)[:candidate_k]

    def _vector_search_documents(
        self,
        documents: Sequence[Dict[str, Any]],
        queries: Sequence[str],
        *,
        candidate_k: int,
        ai_provider: Optional[str],
        intent: str,
        must_contain: Sequence[str],
        section_ref: Optional[str],
    ) -> List[EvidenceHit]:
        try:
            from services.contract_agent.rag import ContractRAGSystem
        except Exception:
            return []

        hits: List[EvidenceHit] = []
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
                        search_kwargs=self._vector_search_kwargs(document=document, namespace=namespace, k=candidate_k)
                    ).invoke(query)
                except Exception:
                    continue
                for rank, doc in enumerate(docs or []):
                    metadata = dict(getattr(doc, "metadata", None) or {})
                    metadata["text"] = getattr(doc, "page_content", "") or metadata.get("text") or metadata.get("content")
                    hit = self._hit_from_vector_chunk(
                        metadata,
                        document_by_id={str(document.get("_id")): document},
                        backend="vector",
                        queries=[query],
                        intent=intent,
                        must_contain=must_contain,
                        section_ref=section_ref,
                        requires_read=True,
                    )
                    if not hit:
                        continue
                    hit.score += max(0.0, 2.0 - (query_index * 0.2)) + max(0.0, (candidate_k - rank) * 0.05)
                    hit.scores["vector_rank"] = float(rank + 1)
                    if hit.score > 0:
                        hits.append(hit)
        return self._rerank_hits(hits, queries=queries, intent=intent, must_contain=must_contain, section_ref=section_ref)[:candidate_k]

    def _fallback_segment_search(
        self,
        documents: Sequence[Dict[str, Any]],
        queries: Sequence[str],
        *,
        candidate_k: int,
        intent: str,
        must_contain: Sequence[str],
        section_ref: Optional[str],
    ) -> List[EvidenceHit]:
        hits: List[EvidenceHit] = []
        for document in documents:
            for hit in self._legal_document_hits(
                document,
                queries=queries,
                intent=intent,
                must_contain=must_contain,
                section_ref=section_ref,
                requires_read=True,
            ):
                if hit.score > 0:
                    hits.append(hit)
        return self._rerank_hits(hits, queries=queries, intent=intent, must_contain=must_contain, section_ref=section_ref)[:candidate_k]

    def _legal_document_hits(
        self,
        document: Dict[str, Any],
        *,
        queries: Optional[Sequence[str]] = None,
        intent: str = "normal",
        must_contain: Optional[Sequence[str]] = None,
        section_ref: Optional[str] = None,
        requires_read: bool = False,
    ) -> List[EvidenceHit]:
        content = ((document.get("index") or {}).get("content") or "")
        if not content.strip():
            return []
        doc_id = str(document.get("_id") or "")
        filename = document.get("contract_name") or doc_id

        # Use cached segments if available (avoids re-segmenting on every fallback query)
        segments: List[TextSegment] = []
        index_data = document.get("index") or {}
        cached_segments_raw = index_data.get("segments")
        cached_schema = index_data.get("chunk_schema_version")
        current_schema = getattr(settings, "chunk_schema_version", 2) if hasattr(self, "_settings") else 2

        if cached_segments_raw and cached_schema == current_schema:
            try:
                segments = [TextSegment(**seg) for seg in cached_segments_raw]
            except Exception:
                cached_segments_raw = None

        if not segments:
            # Also check module-level cache
            from .vector_store import get_cached_segments
            module_cached = get_cached_segments(doc_id, current_schema)
            if module_cached:
                try:
                    segments = [TextSegment(**seg) for seg in module_cached]
                except Exception:
                    pass

        if not segments:
            clean_text, segments = self.segmenter.segment_text_with_page_markers(content)
        else:
            clean_text = content

        hits: List[EvidenceHit] = []
        for segment in segments:
            enriched = segment.model_copy(update={
                "contract_id": doc_id,
                "contract_name": filename,
            })
            hit = self._hit_from_segment(
                enriched,
                queries=queries if queries is not None else [],
                intent=intent,
                must_contain=must_contain or [],
                section_ref=section_ref,
                full_text=clean_text,
                requires_read=requires_read,
            )
            if hit:
                hit.retrieval_backend = "legal_fallback"
                hits.append(hit)
        return hits

    def _hit_from_segment(
        self,
        segment: TextSegment,
        *,
        queries: Sequence[str],
        intent: str,
        must_contain: Optional[Sequence[str]] = None,
        section_ref: Optional[str] = None,
        full_text: Optional[str] = None,
        requires_read: bool,
    ) -> Optional[EvidenceHit]:
        text = clean_text_encoding(segment.text or "").strip()
        if not text:
            return None
        score, components = score_evidence_text(
            text=text,
            section=segment.section_path or "",
            tags=segment.section_tags or [],
            value_types=segment.value_types or [],
            chunk_level=segment.chunk_level or segment.type,
            queries=queries,
            intent=intent,
            must_contain=must_contain or [],
            section_ref=section_ref,
        )
        if score <= 0 and must_contain:
            return None

        quote, context_before, context_after, local_start, local_end = extract_exact_span(
            text,
            queries=queries,
            must_contain=must_contain or [],
            section_ref=section_ref,
        )
        char_start = segment.char_start if segment.char_start is not None else segment.start_index
        char_end = segment.char_end if segment.char_end is not None else segment.end_index
        if local_start is not None and char_start is not None:
            char_start = char_start + local_start
        if local_end is not None and (segment.char_start is not None or segment.start_index is not None):
            base_start = segment.char_start if segment.char_start is not None else segment.start_index
            char_end = base_start + local_end
        doc_id = segment.contract_id
        evidence_id = stable_evidence_id(doc_id, segment.id, text)
        return EvidenceHit(
            evidence_id=evidence_id,
            segment_id=segment.id,
            document_id=doc_id,
            filename=segment.contract_name or doc_id,
            page_start=segment.page_start or segment.page_number,
            page_end=segment.page_end or segment.page_start or segment.page_number,
            section_path=segment.section_path,
            char_start=char_start,
            char_end=char_end,
            quote=quote,
            context=compact_context(context_before, quote, context_after),
            context_before=context_before,
            context_after=context_after,
            chunk_level=segment.chunk_level or segment.type,
            retrieval_backend="segment",
            score=score,
            scores=components,
            section_tags=segment.section_tags or [],
            value_types=segment.value_types or [],
            requires_read=requires_read,
        )

    def _hit_from_vector_chunk(
        self,
        raw: Dict[str, Any],
        *,
        document_by_id: Dict[str, Dict[str, Any]],
        backend: str,
        queries: Sequence[str],
        intent: str,
        must_contain: Sequence[str],
        section_ref: Optional[str],
        requires_read: bool,
    ) -> Optional[EvidenceHit]:
        text = str(metadata_value(raw, "text") or metadata_value(raw, "page_content") or metadata_value(raw, "content") or "").strip()
        if not text:
            return None
        doc_id = str(metadata_value(raw, "document_id") or metadata_value(raw, "contract_id") or "")
        if doc_id and doc_id not in document_by_id:
            return None
        if not doc_id and len(document_by_id) == 1:
            doc_id = next(iter(document_by_id))
        if not doc_id:
            return None
        source_document = document_by_id.get(doc_id, {})
        filename = str(metadata_value(raw, "contract_name") or source_document.get("contract_name") or doc_id)
        section = metadata_value(raw, "section_path")
        tags = list_value(metadata_value(raw, "section_tags"))
        value_types = list_value(metadata_value(raw, "value_types"))
        chunk_level = metadata_value(raw, "chunk_level")
        score, components = score_evidence_text(
            text=text,
            section=str(section or ""),
            tags=tags,
            value_types=value_types,
            chunk_level=str(chunk_level or ""),
            queries=queries,
            intent=intent,
            must_contain=must_contain,
            section_ref=section_ref,
        )
        if score <= 0 and must_contain:
            return None
        quote, context_before, context_after, local_start, local_end = extract_exact_span(
            text,
            queries=queries,
            must_contain=must_contain,
            section_ref=section_ref,
        )
        raw_start = coerce_int(metadata_value(raw, "char_start"))
        raw_end = coerce_int(metadata_value(raw, "char_end"))
        char_start = raw_start + local_start if raw_start is not None and local_start is not None else raw_start
        char_end = raw_start + local_end if raw_start is not None and local_end is not None else raw_end
        segment_id = str(metadata_value(raw, "segment_id") or "")
        evidence_id = str(metadata_value(raw, "evidence_id") or "") or stable_evidence_id(doc_id, segment_id, text)
        return EvidenceHit(
            evidence_id=evidence_id,
            segment_id=segment_id or evidence_id,
            document_id=doc_id,
            filename=filename,
            page_start=coerce_int(metadata_value(raw, "page_start") or metadata_value(raw, "page_number")),
            page_end=coerce_int(metadata_value(raw, "page_end") or metadata_value(raw, "page_start") or metadata_value(raw, "page_number")),
            section_path=str(section) if section else None,
            char_start=char_start,
            char_end=char_end,
            quote=quote,
            context=compact_context(context_before, quote, context_after),
            context_before=context_before,
            context_after=context_after,
            chunk_level=str(chunk_level) if chunk_level else None,
            retrieval_backend=backend,
            score=score,
            scores=components,
            section_tags=tags,
            value_types=value_types,
            requires_read=requires_read,
        )

    def _fuse_ranked_hits(
        self,
        ranked_sets: Sequence[Tuple[Sequence[EvidenceHit], float, str]],
        *,
        top_k: int,
        queries: Sequence[str],
        intent: str,
        must_contain: Sequence[str],
        section_ref: Optional[str],
    ) -> List[EvidenceHit]:
        scores: Dict[Tuple[str, str], float] = {}
        hits_by_key: Dict[Tuple[str, str], EvidenceHit] = {}
        sources_by_key: Dict[Tuple[str, str], List[str]] = {}
        rrf_k = 60.0
        for hits, weight, source in ranked_sets:
            for rank, hit in enumerate(hits):
                key = hit.key()
                if key not in hits_by_key or hit.score > hits_by_key[key].score:
                    hits_by_key[key] = hit
                sources_by_key.setdefault(key, []).append(source)
                scores[key] = scores.get(key, 0.0) + (weight / (rrf_k + rank + 1)) + (min(hit.score, 60.0) * weight * 0.001)

        fused: List[EvidenceHit] = []
        for key, hit in hits_by_key.items():
            hit.scores = dict(hit.scores or {})
            hit.scores["rrf_score"] = scores.get(key, 0.0)
            hit.scores["source_count"] = float(len(set(sources_by_key.get(key, []))))
            hit.score = hit.score + (scores.get(key, 0.0) * 120.0) + (len(set(sources_by_key.get(key, []))) * 0.5)
            if len(set(sources_by_key.get(key, []))) > 1:
                hit.retrieval_backend = "hybrid_v2"
            fused.append(hit)
        ranked = self._rerank_hits(fused, queries=queries, intent=intent, must_contain=must_contain, section_ref=section_ref)

        # Optional cross-encoder reranker (VoyageAI rerank-2-lite)
        if getattr(settings, "voyage_rerank_enabled", False):
            from .reranker import rerank_evidence_hits
            candidates = ranked[: getattr(settings, "voyage_rerank_top_k", 20)]
            reranked = rerank_evidence_hits(
                " ".join(queries),
                candidates,
                top_k=getattr(settings, "voyage_rerank_final_k", 8),
            )
            # Append any non-reranked hits after the reranked ones
            reranked_ids = {hit.evidence_id for hit in reranked}
            remainder = [hit for hit in ranked if hit.evidence_id not in reranked_ids]
            ranked = reranked + remainder

        return ranked[: max(1, min(top_k, 20))]

    def _rerank_hits(
        self,
        hits: Sequence[EvidenceHit],
        *,
        queries: Sequence[str],
        intent: str,
        must_contain: Sequence[str],
        section_ref: Optional[str],
    ) -> List[EvidenceHit]:
        del queries, must_contain

        def rank_key(hit: EvidenceHit) -> Tuple[float, int, int, str]:
            level = (hit.chunk_level or "").lower()
            level_boost = {"fact": {"micro": 4, "meso": 1.5, "macro": -5}, "summary": {"macro": 3, "meso": 1, "micro": -1}}.get(intent, {}).get(level, 0)
            section_boost = 6 if section_ref and section_ref.lower() in (hit.section_path or "").lower() else 0
            score = hit.score + level_boost + section_boost
            page = hit.page_start or 10_000
            start = hit.char_start or 0
            return (-score, page, start, hit.evidence_id)

        deduped: Dict[Tuple[str, str], EvidenceHit] = {}
        for hit in hits:
            key = hit.key()
            existing = deduped.get(key)
            if existing is None or rank_key(hit) < rank_key(existing):
                deduped[key] = hit
        return sorted(deduped.values(), key=rank_key)

    def _register_hit_aliases(self, by_id: Dict[str, EvidenceHit], hit: EvidenceHit) -> None:
        aliases = {
            hit.evidence_id,
            hit.segment_id,
        }
        if hit.document_id and hit.segment_id and not str(hit.segment_id).startswith(f"{hit.document_id}:"):
            aliases.add(f"{hit.document_id}:{hit.segment_id}")
        if ":" in hit.evidence_id:
            aliases.add(hit.evidence_id.split(":", 1)[1])
        for alias in aliases:
            if alias:
                by_id[str(alias)] = hit

    def _vector_collection(self, collection: Any) -> Any:
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

    def _vector_search_kwargs(self, document: Dict[str, Any], namespace: str, k: int) -> Dict[str, Any]:
        pre_filter: Dict[str, Any] = {}
        if namespace:
            pre_filter["namespace"] = {"$eq": namespace}
        search_kwargs: Dict[str, Any] = {"k": k}
        if pre_filter:
            search_kwargs["pre_filter"] = pre_filter
        return search_kwargs


def score_evidence_text(
    *,
    text: str,
    section: str,
    tags: Sequence[str],
    value_types: Sequence[str],
    chunk_level: str,
    queries: Sequence[str],
    intent: str,
    must_contain: Sequence[str],
    section_ref: Optional[str],
) -> Tuple[float, Dict[str, float]]:
    searchable = " ".join([text or "", section or "", " ".join(tags or []), " ".join(value_types or [])])
    lowered = searchable.lower()
    if not lowered.strip():
        return 0.0, {}
    if must_contain and not all(item.lower() in lowered for item in must_contain if item.strip()):
        return 0.0, {"must_contain_missing": 1.0}

    query_text = " ".join(queries)
    query_tokens = set(query_terms(query_text))
    expanded_terms = expanded_query_terms(query_text)
    text_tokens = set(query_terms(lowered))

    components: Dict[str, float] = {}
    score = 0.0
    for query in queries:
        query_lower = query.lower().strip()
        if query_lower and query_lower in lowered:
            components["exact_query"] = components.get("exact_query", 0.0) + 10.0
            score += 10.0

    overlap = query_tokens & text_tokens
    components["token_overlap"] = float(len(overlap))
    score += len(overlap) * 2.5
    score += len(overlap) / max(len(query_tokens), 1)

    phrase_score = 0.0
    for term in expanded_terms:
        if len(term) < 3:
            continue
        if " " in term:
            if term in lowered:
                phrase_score += 5.0
        elif re.search(rf"\b{re.escape(term)}\b", lowered):
            phrase_score += 1.5
    if phrase_score:
        components["legal_terms"] = phrase_score
        score += phrase_score

    if section_ref and section_ref.lower() in lowered:
        components["section_ref"] = 18.0
        score += 18.0

    level = (chunk_level or "").lower()
    if intent == "fact":
        level_score = {"micro": 4.0, "meso": 2.0, "macro": -5.0}.get(level, 0.0)
    elif intent == "summary":
        level_score = {"macro": 3.0, "meso": 1.0, "micro": -1.0}.get(level, 0.0)
    else:
        level_score = {"meso": 1.0, "micro": 0.5, "macro": -1.0}.get(level, 0.0)
    if level_score:
        components["chunk_level"] = level_score
        score += level_score

    if intent == "fact" and value_types:
        components["value_type"] = 1.5
        score += 1.5
    if tags and any(tag.replace("_", " ") in query_text.lower() or tag in query_text.lower() for tag in tags):
        components["section_tag"] = 2.0
        score += 2.0
    return score, components


def extract_exact_span(
    text: str,
    *,
    queries: Sequence[str],
    must_contain: Sequence[str],
    section_ref: Optional[str],
    max_chars: int = 650,
) -> Tuple[str, str, str, Optional[int], Optional[int]]:
    clean = clean_text_encoding(text or "").strip()
    if not clean:
        return "", "", "", None, None
    normalized = re.sub(r"[ \t\f\v]+", " ", clean)
    lowered = normalized.lower()

    phrases: List[str] = []
    if section_ref:
        phrases.append(section_ref)
    phrases.extend(item for item in must_contain if item)
    for query in queries:
        compact = re.sub(r"\s+", " ", query or "").strip()
        if 4 <= len(compact) <= 120:
            phrases.append(compact)
    phrases.extend(expanded_query_terms(" ".join(queries)))
    phrases = sorted(dict.fromkeys(phrase.lower() for phrase in phrases if len(phrase.strip()) >= 3), key=len, reverse=True)

    anchor = -1
    anchor_len = 0
    for phrase in phrases:
        match = re.search(rf"\b{re.escape(phrase)}\b", lowered) if re.match(r"^[a-z0-9_ -]+$", phrase) else None
        if match:
            anchor = match.start()
            anchor_len = match.end() - match.start()
            break
        idx = lowered.find(phrase)
        if idx >= 0:
            anchor = idx
            anchor_len = len(phrase)
            break

    if anchor < 0:
        if len(normalized) <= max_chars:
            return normalized, "", "", 0, len(normalized)
        anchor = 0
        anchor_len = min(80, len(normalized))

    start = sentence_left_boundary(normalized, anchor)
    end = sentence_right_boundary(normalized, anchor + anchor_len)
    if end - start > max_chars or end <= start:
        half = max_chars // 2
        start = max(0, anchor - half)
        end = min(len(normalized), start + max_chars)
        start = word_boundary_left(normalized, start)
        end = word_boundary_right(normalized, end)
    if end - start < 80:
        paragraph_start = normalized.rfind("\n\n", 0, start)
        paragraph_end = normalized.find("\n\n", start)
        if paragraph_start < 0:
            paragraph_start = 0
        else:
            paragraph_start += 2
        if paragraph_end < 0:
            paragraph_end = len(normalized)
        start = max(paragraph_start, start - 80)
        end = min(paragraph_end, end + 120)
        start = word_boundary_left(normalized, start)
        end = word_boundary_right(normalized, end)
    if end - start > max_chars:
        end = word_boundary_right(normalized, min(len(normalized), start + max_chars))

    quote = normalized[start:end].strip()
    context_before = normalized[max(0, start - 280):start].strip()
    context_after = normalized[end:min(len(normalized), end + 360)].strip()
    return quote, context_before, context_after, start, end


def compact_context(context_before: str, quote: str, context_after: str, *, max_chars: int = 1400) -> str:
    parts = []
    if context_before:
        parts.append(context_before[-320:])
    parts.append(quote)
    if context_after:
        parts.append(context_after[:420])
    context = " ".join(part.strip() for part in parts if part.strip())
    return context[:max_chars].strip()


def normalize_queries(values: Iterable[Any]) -> List[str]:
    if values in (None, "", [], {}):  # type: ignore[comparison-overlap]
        return []
    if isinstance(values, (str, bytes)):
        raw_values: Iterable[Any] = [values]
    else:
        raw_values = values
    normalized: List[str] = []
    for value in raw_values:
        if value in (None, "", [], {}):
            continue
        if isinstance(value, dict):
            normalized.extend(normalize_queries(value.get("queries") or value.get("query") or value.values()))
            continue
        text = re.sub(r"\s+", " ", str(value)).strip()
        if text and text not in normalized:
            normalized.append(text)
    return normalized[:12]


def normalize_section_ref(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()
    match = re.search(r"\b(?:section|sec\.?|clause|article)\s+([A-Za-z0-9IVXLC.\-]+)\b", text, flags=re.IGNORECASE)
    return match.group(1).upper() if match else text


def infer_intent(query: str) -> str:
    normalized = (query or "").lower()
    if any(term in normalized for term in ["compare", "comparison", "between", "across", "all contract", "each document"]):
        return "compare"
    if any(term in normalized for term in ["summarize", "summary", "overview", "major sections"]):
        return "summary"
    if any(term in normalized for term in [
        "payment",
        "pay",
        "paid",
        "fee",
        "price",
        "deadline",
        "due",
        "notice",
        "days",
        "date",
        "amount",
        "percentage",
        "clause",
        "section",
        "obligation",
    ]):
        return "fact"
    return "normal"


def query_terms(text: str) -> List[str]:
    return [
        token
        for token in re.findall(r"[a-zA-Z0-9][a-zA-Z0-9_$%.-]{1,}", (text or "").lower())
        if token not in STOP_WORDS and token.strip()
    ]


def expanded_query_terms(query: str) -> List[str]:
    base_terms = query_terms(query)
    expanded = list(base_terms)
    lowered = (query or "").lower()
    for trigger, synonyms in LEGAL_SYNONYMS.items():
        if trigger in lowered or trigger in base_terms:
            expanded.extend(synonyms)
    seen = set()
    return [term for term in expanded if term and not (term in seen or seen.add(term))]


def stable_evidence_id(doc_id: Optional[str], segment_id: str, text: str) -> str:
    if doc_id and segment_id:
        return segment_id if segment_id.startswith(f"{doc_id}:") else f"{doc_id}:{segment_id}"
    if segment_id:
        return segment_id
    digest = hashlib.sha1((text or "")[:500].encode("utf-8")).hexdigest()[:14]
    return f"evidence:{digest}"


def metadata_value(raw: Dict[str, Any], key: str) -> Any:
    if key in raw and raw.get(key) not in (None, ""):
        return raw.get(key)
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    return metadata.get(key)


def list_value(value: Any) -> List[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)]


def coerce_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def sentence_left_boundary(text: str, index: int) -> int:
    candidates = [text.rfind(marker, 0, index) for marker in [". ", "; ", "\n", "\n\n"]]
    candidates = [candidate + 1 for candidate in candidates if candidate >= 0]
    return max(candidates) if candidates else 0


def sentence_right_boundary(text: str, index: int) -> int:
    candidates = [text.find(marker, index) for marker in [". ", "; ", "\n", "\n\n"]]
    candidates = [candidate + 1 for candidate in candidates if candidate >= 0]
    return min(candidates) if candidates else len(text)


def word_boundary_left(text: str, index: int) -> int:
    while index > 0 and text[index - 1].isalnum():
        index -= 1
    return index


def word_boundary_right(text: str, index: int) -> int:
    while index < len(text) and text[index:index + 1].isalnum():
        index += 1
    return index


__all__ = [
    "EvidenceHit",
    "EvidenceRetrievalService",
    "extract_exact_span",
    "infer_intent",
    "normalize_queries",
    "score_evidence_text",
]
