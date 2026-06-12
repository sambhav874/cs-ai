"""Prompt-context and evidence helper tools for the contract agent."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.documents import Document

from core.config import settings
from utils.secure_logger import log_exception
from utils.text_cleanup import clean_text_encoding

from .evidence_service import EvidenceRetrievalService
from .schemas import TextSegment


@dataclass
class EvidenceToolbox:
    """Small tool facade used by the agent runner.

    Retrieval mechanics stay stable and auditable; the agent decides when and
    how to use the evidence rather than relying on a large hardcoded prompt.
    """

    owner: Any

    def __post_init__(self) -> None:
        self.evidence_service = EvidenceRetrievalService()

    def list_documents(self, segments: List[TextSegment]) -> List[Dict[str, Any]]:
        documents: Dict[str, Dict[str, Any]] = {}
        for segment in segments:
            key = segment.contract_id or segment.contract_name or "document"
            item = documents.setdefault(
                key,
                {
                    "document_id": segment.contract_id,
                    "document_name": segment.contract_name,
                    "segment_count": 0,
                    "pages": set(),
                },
            )
            item["segment_count"] += 1
            page = segment.page_start or segment.page_number
            if page:
                item["pages"].add(page)
        return [
            {**value, "pages": sorted(value["pages"])}
            for value in documents.values()
        ]

    def outline_document(self, segments: List[TextSegment], limit: int = 40) -> List[Dict[str, Any]]:
        seen = set()
        outline: List[Dict[str, Any]] = []
        for segment in segments:
            section = segment.section_path
            if not section or section in seen:
                continue
            seen.add(section)
            outline.append({
                "section": section,
                "document": segment.contract_name,
                "page": segment.page_start or segment.page_number,
            })
            if len(outline) >= limit:
                break
        return outline

    def search_evidence(self, segments: List[TextSegment], query: str, limit: int = 8) -> List[Dict[str, Any]]:
        return self.evidence_service.search_segments(segments, query, limit=limit)

    def read_evidence(self, segments: List[TextSegment], segment_ids: List[str]) -> List[TextSegment]:
        segment_map = {segment.id: segment for segment in segments}
        return [segment_map[segment_id] for segment_id in segment_ids if segment_id in segment_map]

    def read_evidence_summary(self, segments: List[TextSegment], segment_ids: List[str]) -> List[Dict[str, Any]]:
        return self.evidence_service.read_segments(segments, segment_ids)

    def get_kpi_context(self, memory_context: str) -> Dict[str, Any]:
        lines = [
            line.strip()
            for line in (memory_context or "").splitlines()
            if "kpi" in line.lower() or "sla" in line.lower() or "threshold" in line.lower() or "breach" in line.lower()
        ]
        return {"lines": lines, "count": len(lines)}

    def calculate_from_evidence(self, text: str) -> Dict[str, Any]:
        """Return simple numeric values available for model-visible calculations."""
        import re

        values = [float(match.replace(",", "")) for match in re.findall(r"\b\d[\d,]*(?:\.\d+)?\b", text or "")]
        return {"values": values, "count": len(values)}

    def _summaries_for_segment_ids(self, segments: List[TextSegment], segment_ids: List[str]) -> List[Dict[str, Any]]:
        segment_map = {segment.id: segment for segment in segments}
        return [
            self._summary(segment_map[segment_id])
            for segment_id in segment_ids
            if segment_id in segment_map
        ]

    def _summary(self, segment: TextSegment) -> Dict[str, Any]:
        text = clean_text_encoding(segment.text or "")
        return {
            "evidence_id": f"{segment.contract_id}:{segment.id}" if segment.contract_id else segment.id,
            "segment_id": segment.id,
            "document_id": segment.contract_id,
            "document": segment.contract_name,
            "page": segment.page_start or segment.page_number,
            "page_start": segment.page_start or segment.page_number,
            "page_end": segment.page_end or segment.page_start or segment.page_number,
            "section": segment.section_path,
            "section_path": segment.section_path,
            "type": segment.chunk_level or segment.type,
            "chunk_level": segment.chunk_level or segment.type,
            "quote": text[:700] + (" ..." if len(text) > 700 else ""),
            "context": text[:1200] + (" ..." if len(text) > 1200 else ""),
            "excerpt": text[:700] + (" ..." if len(text) > 700 else ""),
        }

    def _query_terms(self, query: str) -> set[str]:
        stop_words = {
            "about",
            "after",
            "also",
            "between",
            "contract",
            "contracts",
            "document",
            "documents",
            "from",
            "into",
            "show",
            "that",
            "the",
            "their",
            "there",
            "this",
            "what",
            "when",
            "where",
            "which",
            "with",
        }
        return {
            term
            for term in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", (query or "").lower())
            if term not in stop_words
        }


class LegacyRetrievalBridge:
    """Compatibility owner for older hybrid retrieval helpers.

    Public behavior and metadata key casing stay unchanged; this class simply
    moves retrieval plumbing out of the large legacy facade.
    """

    def __init__(self, owner: Any):
        self.owner = owner
        self.logger = getattr(owner, "logger", None)

    def _question_tokens(self, text: str) -> set:
        stop_words = {
            "about", "after", "again", "against", "also", "are", "between", "but", "can", "contract",
            "contracts", "document", "documents", "does", "from", "have", "how", "into", "more", "must",
            "need", "not", "only", "other", "project", "review", "should", "show", "that", "the", "there",
            "these", "this", "things", "through", "what", "when", "where", "which", "with", "work", "would",
        }
        return {
            token
            for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", (text or "").lower())
            if token not in stop_words
        }

    def _project_question_needs_coverage(self, question: str, document_count: int) -> bool:
        if document_count <= 1:
            return False

        normalized_question = (question or "").lower()
        project_scope_phrases = [
            "all contract", "all document", "each contract", "each document", "every contract",
            "every document", "across", "between", "compare", "comparison", "project", "multiple",
            "other contract", "other document", "ratecard", "rate card",
        ]
        synthesis_terms = [
            "obligation", "deadline", "termination", "payment", "deliverable", "milestone", "risk",
            "rate", "pricing", "fee", "summary", "summarize", "review",
        ]
        return any(phrase in normalized_question for phrase in project_scope_phrases) or any(
            term in normalized_question for term in synthesis_terms
        )

    def _retrieval_intent(self, question: str, document_count: int = 1) -> str:
        normalized_question = (question or "").lower()
        if document_count > 1 and any(
            term in normalized_question
            for term in ["compare", "comparison", "between", "across", "all contract", "all document", "each contract", "each document", "project"]
        ):
            return "compare"
        if any(term in normalized_question for term in ["summarize", "summary", "overview", "what is this document", "what are these documents"]):
            return "summary"
        if any(
            term in normalized_question
            for term in [
                "payment", "pay", "paid", "fee", "fees", "price", "pricing", "rate", "ratecard",
                "deadline", "due", "notice", "within", "days", "months", "years", "date",
                "penalty", "liquidated damages", "amount", "percentage", "percent",
            ]
        ):
            return "fact"
        return "normal"

    def _chunk_level_boost(self, segment_or_doc: Any, question: str, document_count: int = 1) -> float:
        metadata = getattr(segment_or_doc, "metadata", None) or {}
        level = (
            metadata.get("chunk_level")
            or getattr(segment_or_doc, "chunk_level", None)
            or getattr(segment_or_doc, "type", None)
            or ""
        )
        level = str(level).lower()
        intent = self._retrieval_intent(question, document_count=document_count)

        boosts = {
            "normal": {"meso": 1.5, "micro": 0.2, "macro": -1.5},
            "fact": {"micro": 3.0, "meso": 1.0, "macro": -4.0},
            "summary": {"macro": 2.2, "meso": 0.9, "micro": -0.8},
            "compare": {"macro": 1.5, "meso": 1.4, "micro": 0.6},
        }
        return boosts.get(intent, {}).get(level, 0.0)

    def _score_segment_for_project_question(self, segment: TextSegment, question: str) -> float:
        text = (segment.text or "").lower()
        if not text.strip():
            return 0.0

        question_tokens = self._question_tokens(question)
        text_tokens = self._question_tokens(text)
        overlap_score = len(question_tokens & text_tokens) * 2.0
        score = overlap_score
        normalized_question = (question or "").lower()

        keyword_groups = {
            "obligation": ["shall", "must", "required", "obligation", "covenant", "agree", "responsible"],
            "deadline": ["within", "days", "date", "deadline", "due", "notice", "period", "no later"],
            "termination": ["terminate", "termination", "breach", "default", "cure", "notice"],
            "payment": ["payment", "pay", "paid", "invoice", "fee", "fees", "amount", "compensation"],
            "rate": ["rate", "rates", "ratecard", "pricing", "price", "fee", "fees", "amount"],
            "deliverable": ["deliver", "delivery", "deliverable", "milestone", "schedule"],
            "risk": ["liability", "indemn", "warranty", "risk", "loss", "damages", "limitation"],
        }
        for trigger, related_terms in keyword_groups.items():
            if trigger in normalized_question and any(term in text for term in related_terms):
                score += 4.0

        score += self._chunk_level_boost(segment, question)
        if re.search(r"\b\d+\s*(day|days|month|months|year|years)\b", text):
            score += 1.5
        if (segment.chunk_level or segment.type) == "meso":
            score += 0.5
        if segment.page_number and segment.page_number <= 2:
            score += 0.25
        return score

    def _segment_to_prompt_document(self, segment: TextSegment) -> Document:
        return Document(
            page_content=clean_text_encoding(segment.text),
            metadata={
                "source": segment.contract_name or segment.contract_id or "Project document",
                "segment_id": segment.id,
                "contract_id": segment.contract_id,
                "document_id": segment.contract_id,
                "contract_name": segment.contract_name,
                "page_number": segment.page_number,
                "page_start": segment.page_start,
                "page_end": segment.page_end,
                "chunk_schema_version": segment.chunk_schema_version,
                "chunk_level": segment.chunk_level or segment.type,
                "section_path": segment.section_path,
                "section_tags": segment.section_tags,
                "char_start": segment.char_start,
                "char_end": segment.char_end,
                "parent_chunk_id": segment.parent_chunk_id or segment.parent_id,
                "entities": segment.entities,
                "cross_refs": segment.cross_refs,
                "obligation_parties": segment.obligation_parties,
                "referenced_documents": segment.referenced_documents,
                "value_types": segment.value_types,
            },
        )

    def _retrieval_query_terms(self, question: str) -> List[str]:
        """Deterministic legal query expansion without an LLM call."""
        base_terms = sorted(self._question_tokens(question))
        normalized_question = (question or "").lower()
        legal_synonyms = {
            "payment": ["pay", "paid", "invoice", "fee", "fees", "price", "pricing", "compensation"],
            "termination": ["terminate", "terminated", "default", "breach", "cure", "notice"],
            "deadline": ["within", "days", "due", "period", "no later", "schedule"],
            "obligation": ["shall", "must", "required", "responsible", "covenant", "agree"],
            "rate": ["ratecard", "rate card", "rates", "pricing", "price", "fee", "fees"],
            "liability": ["indemnity", "indemnification", "damages", "loss", "limitation"],
            "confidential": ["confidentiality", "non-disclosure", "disclose", "proprietary"],
            "renewal": ["renew", "extension", "extend", "term"],
            "notice": ["notify", "notification", "written notice", "days"],
        }
        expanded: List[str] = list(base_terms)
        for trigger, synonyms in legal_synonyms.items():
            if trigger in normalized_question or trigger in base_terms:
                expanded.extend(synonyms)
        seen = set()
        return [term for term in expanded if term and not (term in seen or seen.add(term))]

    def _segment_retrieval_score(self, segment: TextSegment, question: str) -> float:
        segment_text = (segment.text or "").lower()
        if not segment_text.strip() or segment.type == "sentence":
            return 0.0

        query_terms = self._retrieval_query_terms(question)
        query_token_set = set(self._question_tokens(question))
        segment_token_set = self._question_tokens(segment_text)
        score = 0.0

        score += len(query_token_set & segment_token_set) * 3.0
        for term in query_terms:
            if len(term) < 3:
                continue
            if " " in term:
                if term in segment_text:
                    score += 6.0
            elif re.search(rf"\b{re.escape(term)}\b", segment_text):
                score += 2.0

        if re.search(r"\b(section|article|clause|schedule|exhibit)\s+[a-z0-9ivxlc.\-]+", segment_text):
            score += 1.0
        if re.search(r"\b\d+(?:\.\d+)?\s*(?:%|days?|months?|years?|\$|usd|rsu|shares?)\b", segment_text):
            score += 1.25
        score += self._chunk_level_boost(segment, question)
        if segment.value_types and self._retrieval_intent(question) == "fact":
            score += 1.5
        if segment.section_tags:
            normalized_question = (question or "").lower()
            if any(tag.replace("_", " ") in normalized_question or tag in normalized_question for tag in segment.section_tags):
                score += 2.0
        if segment.page_number and segment.page_number <= 2:
            score += 0.4
        if (segment.chunk_level or segment.type) == "meso":
            score += 0.5
        return score

    def _keyword_segment_documents(
        self,
        segments: List[TextSegment],
        question: str,
        *,
        top_k: int,
    ) -> List[Document]:
        intent = self._retrieval_intent(question, document_count=len({s.contract_id or s.contract_name for s in segments}))

        def include_segment(segment: TextSegment) -> bool:
            level = (segment.chunk_level or segment.type or "").lower()
            if segment.type == "sentence" or not (segment.text or "").strip():
                return False
            if intent in {"fact", "normal"} and level == "macro":
                return False
            if intent == "summary" and level == "micro":
                return False
            return True

        scored = sorted(
            (
                (self._segment_retrieval_score(segment, question), segment)
                for segment in segments
                if include_segment(segment)
            ),
            key=lambda item: (
                -item[0],
                item[1].page_number if item[1].page_number is not None else 10_000,
                item[1].start_index,
            ),
        )
        return [
            self._segment_to_prompt_document(segment)
            for score, segment in scored[:top_k]
            if score > 0
        ]

    def _named_heading_candidates(self, question: str) -> List[str]:
        normalized_question = re.sub(r"\s+", " ", (question or "").lower()).strip()
        candidates: List[str] = []
        patterns = [
            r"\b(?:in|under|from|of)\s+(?:the\s+)?([a-z0-9][a-z0-9\s&/.\-]{2,80}?)\s+(?:table|section|clause|exhibit)\b",
            r"\b([a-z0-9][a-z0-9\s&/.\-]{2,80}?)\s+(?:table|section|clause|exhibit)\b",
        ]
        trim_prefix = re.compile(
            r"^(?:what|which|show|list|cite|tell|are|is|the|a|an|threshold|midpoint|maximum|minimum|and|or|in|from|of|under)\s+"
        )
        for pattern in patterns:
            for match in re.finditer(pattern, normalized_question):
                candidate = match.group(1).strip(" .:-")
                while True:
                    trimmed = trim_prefix.sub("", candidate).strip()
                    if trimmed == candidate:
                        break
                    candidate = trimmed
                words = candidate.split()
                if 1 < len(words) <= 8 and candidate not in candidates:
                    candidates.append(candidate)
        return candidates

    def _named_heading_documents(
        self,
        segments: List[TextSegment],
        question: str,
        *,
        top_k: int,
    ) -> List[Document]:
        candidates = self._named_heading_candidates(question)
        if not candidates:
            return []

        ordered_segments = [
            segment for segment in segments
            if segment.type != "sentence" and (segment.text or "").strip()
        ]
        scored: List[Tuple[float, int, TextSegment]] = []
        for index, segment in enumerate(ordered_segments):
            haystacks = [
                re.sub(r"\s+", " ", (segment.text or "").lower()),
                re.sub(r"\s+", " ", (segment.section_path or "").lower()),
                " ".join(segment.section_tags or []).replace("_", " ").lower(),
            ]
            score = 0.0
            for candidate in candidates:
                candidate_terms = set(candidate.split())
                if any(candidate in haystack for haystack in haystacks):
                    score = max(score, 50.0 + len(candidate_terms))
                elif candidate_terms and candidate_terms <= set(self._question_tokens(" ".join(haystacks))):
                    score = max(score, 18.0 + len(candidate_terms))
            if score:
                scored.append((score, index, segment))

        if not scored:
            return []

        docs: List[Document] = []
        seen_ids = set()
        for _, index, segment in sorted(scored, key=lambda item: (-item[0], item[2].page_number or 10_000, item[2].start_index)):
            neighbor_indices = [index]
            if index > 0 and ordered_segments[index - 1].page_number == segment.page_number:
                neighbor_indices.append(index - 1)
            if index + 1 < len(ordered_segments) and ordered_segments[index + 1].page_number == segment.page_number:
                neighbor_indices.append(index + 1)
            for neighbor_index in neighbor_indices:
                neighbor = ordered_segments[neighbor_index]
                if neighbor.id in seen_ids:
                    continue
                seen_ids.add(neighbor.id)
                docs.append(self._segment_to_prompt_document(neighbor))
                if len(docs) >= top_k:
                    return docs
        return docs

    def _document_rank_key(self, doc: Document) -> str:
        metadata = doc.metadata or {}
        segment_id = metadata.get("segment_id")
        if segment_id:
            return f"segment:{segment_id}"
        namespace = metadata.get("namespace") or metadata.get("contract_id") or metadata.get("source") or ""
        chunk_index = metadata.get("chunk_index")
        if chunk_index is not None:
            return f"chunk:{namespace}:{chunk_index}"
        return f"text:{namespace}:{hashlib.md5((doc.page_content or '')[:500].encode()).hexdigest()}"

    def _rrf_fuse_documents(
        self,
        ranked_sets: List[Tuple[List[Document], float]],
        *,
        max_docs: int,
    ) -> List[Document]:
        scores: Dict[str, float] = {}
        doc_by_key: Dict[str, Document] = {}
        rrf_k = 60.0
        for docs, weight in ranked_sets:
            for rank, doc in enumerate(docs):
                key = self._document_rank_key(doc)
                if key not in doc_by_key:
                    doc_by_key[key] = doc
                scores[key] = scores.get(key, 0.0) + (weight / (rrf_k + rank + 1))

        ranked_keys = sorted(scores, key=lambda key: scores[key], reverse=True)
        fused_docs: List[Document] = []
        for key in ranked_keys[:max_docs]:
            doc = doc_by_key[key]
            doc.metadata = dict(doc.metadata or {})
            doc.metadata["rrf_score"] = round(scores[key], 6)
            fused_docs.append(doc)
        return fused_docs

    def _hybrid_retrieve_documents(
        self,
        *,
        question: str,
        segments: List[TextSegment],
        vector_store: Any = None,
        search_kwargs: Optional[Dict[str, Any]] = None,
        coverage_docs: Optional[List[Document]] = None,
        coverage_first: bool = False,
        max_docs: Optional[int] = None,
    ) -> List[Document]:
        """Fuse vector, lexical, and coverage candidates into a compact ranked set."""
        final_k = max_docs or getattr(settings, "retriever_final_k", 14)
        candidate_k = max(getattr(settings, "retriever_candidate_k", 32), final_k * 2)
        vector_docs: List[Document] = []
        if vector_store:
            try:
                vector_search_kwargs = dict(search_kwargs or {})
                vector_search_kwargs["k"] = max(candidate_k, int(vector_search_kwargs.get("k", 0) or 0))
                vector_docs = vector_store.as_retriever(search_kwargs=vector_search_kwargs).invoke(question)
            except Exception as retrieval_error:
                log_exception(self.logger, "Vector retrieval failed; continuing with lexical candidates.", retrieval_error)
                vector_docs = []

        lexical_docs = self._keyword_segment_documents(segments, question, top_k=candidate_k)
        coverage_docs = coverage_docs or []
        ranked_sets: List[Tuple[List[Document], float]]
        if coverage_first:
            ranked_sets = [(coverage_docs, 2.25), (vector_docs, 2.0), (lexical_docs, 1.5)]
        else:
            named_heading_docs = self._named_heading_documents(segments, question, top_k=min(8, candidate_k))
            ranked_sets = [(named_heading_docs, 3.2), (vector_docs, 2.0), (lexical_docs, 1.75), (coverage_docs, 1.1)]

        fused = self._rrf_fuse_documents(ranked_sets, max_docs=max(final_k * 2, final_k))
        fused = self._rerank_documents_for_intent(fused, question)
        return self._merge_prompt_documents(fused, [], max_docs=final_k)

    def _rerank_documents_for_intent(self, docs: List[Document], question: str) -> List[Document]:
        def rank_score(doc: Document) -> float:
            metadata = doc.metadata or {}
            rrf_score = float(metadata.get("rrf_score") or 0.0)
            level_boost = self._chunk_level_boost(doc, question)
            value_boost = 0.6 if metadata.get("value_types") and self._retrieval_intent(question) == "fact" else 0.0
            return (rrf_score * 100.0) + level_boost + value_boost

        return sorted(
            docs,
            key=lambda doc: (
                -rank_score(doc),
                (doc.metadata or {}).get("page_start") or (doc.metadata or {}).get("page_number") or 10_000,
                (doc.metadata or {}).get("char_start") or 0,
            ),
        )

    def _segment_prompt_text(self, segment: TextSegment, question: str, max_chars: Optional[int] = None) -> str:
        text = re.sub(r"\s+", " ", clean_text_encoding(segment.text or "")).strip()
        max_chars = max(400, max_chars or getattr(settings, "retriever_segment_excerpt_chars", 1200))
        lowered = text.lower()
        for heading in self._named_heading_candidates(question):
            heading_index = lowered.find(heading)
            if heading_index >= 0:
                heading_window = min(max_chars, 760)
                end = min(len(text), heading_index + heading_window)
                suffix = " ..." if end < len(text) else ""
                return text[heading_index:end].strip() + suffix

        if len(text) <= max_chars:
            return text

        terms = [term for term in self._retrieval_query_terms(question) if len(term) >= 4]
        best_index = -1
        for term in terms:
            idx = lowered.find(term.lower())
            if idx >= 0 and (best_index < 0 or idx < best_index):
                best_index = idx

        if best_index < 0:
            return text[:max_chars].rstrip() + " ..."

        half_window = max_chars // 2
        start = max(0, best_index - half_window)
        end = min(len(text), start + max_chars)
        if end - start < max_chars:
            start = max(0, end - max_chars)
        prefix = "... " if start > 0 else ""
        suffix = " ..." if end < len(text) else ""
        return prefix + text[start:end].strip() + suffix

    def _representative_project_context_docs(
        self,
        segments: List[TextSegment],
        question: str,
        max_segments: int,
    ) -> List[Document]:
        grouped_segments: Dict[str, List[TextSegment]] = {}
        for segment in segments:
            if segment.type == "sentence" or not (segment.text or "").strip():
                continue
            document_key = segment.contract_id or segment.contract_name or "project-document"
            grouped_segments.setdefault(document_key, []).append(segment)

        if not grouped_segments:
            return []

        document_count = len(grouped_segments)
        needs_coverage = self._project_question_needs_coverage(question, document_count)
        per_document_budget = max(1, max_segments // max(document_count, 1))
        if needs_coverage:
            per_document_budget = max(2, per_document_budget)
        per_document_budget = min(5 if needs_coverage else 3, per_document_budget)

        selected_segments: List[TextSegment] = []
        seen_segment_ids = set()
        for document_segments in grouped_segments.values():
            ordered_segments = sorted(
                document_segments,
                key=lambda segment: (
                    segment.page_number if segment.page_number is not None else 10_000,
                    segment.start_index,
                ),
            )
            picked_for_document: List[TextSegment] = []

            # Keep one compact macro/header sample from each document so broad questions can name and count documents.
            header_candidates = [
                segment for segment in ordered_segments
                if (segment.chunk_level or segment.type) == "macro"
            ] or ordered_segments[:1]
            for segment in header_candidates[:1]:
                if segment.id not in seen_segment_ids:
                    picked_for_document.append(segment)
                    seen_segment_ids.add(segment.id)

            scored_segments = sorted(
                (
                    (self._score_segment_for_project_question(segment, question), segment)
                    for segment in document_segments
                    if segment.id not in seen_segment_ids
                ),
                key=lambda item: (-item[0], item[1].page_number or 10_000, item[1].start_index),
            )
            for score, segment in scored_segments:
                if len(picked_for_document) >= per_document_budget:
                    break
                if not needs_coverage and score <= 0:
                    continue
                picked_for_document.append(segment)
                seen_segment_ids.add(segment.id)

            selected_segments.extend(picked_for_document[:per_document_budget])
            if len(selected_segments) >= max_segments:
                break

        return [self._segment_to_prompt_document(segment) for segment in selected_segments[:max_segments]]

    def _merge_prompt_documents(
        self,
        primary_docs: List[Document],
        secondary_docs: List[Document],
        max_docs: int,
    ) -> List[Document]:
        merged_docs: List[Document] = []
        seen_keys = set()
        for doc in [*primary_docs, *secondary_docs]:
            metadata = doc.metadata or {}
            key = metadata.get("segment_id") or f"{metadata.get('source', '')}:{doc.page_content[:160]}"
            if key in seen_keys:
                continue
            merged_docs.append(doc)
            seen_keys.add(key)
            if len(merged_docs) >= max_docs:
                break
        return merged_docs


class PromptContextSelector:
    """Build prompt context for model synthesis."""

    def __init__(self, owner: Any):
        self.owner = owner

    def select_segments(
        self,
        *,
        contract_name: str,
        retrieved_docs: List[Document],
        question: str,
        max_segments: Optional[int] = None,
        context_char_budget: Optional[int] = None,
        segment_excerpt_chars: Optional[int] = None,
        prefer_full_context: bool = False,
    ) -> List[TextSegment]:
        segments = getattr(self.owner, "document_segments", {}).get(contract_name, [])
        if not segments:
            return []

        segment_map = {segment.id: segment for segment in segments}
        max_segments_in_prompt = max_segments or getattr(settings, "max_segments_in_prompt", 18)
        char_budget = max(2000, context_char_budget or getattr(settings, "retriever_context_char_budget", 12000))
        selected_segments: List[TextSegment] = []
        seen_segment_ids = set()
        used_chars = 0

        def add_segment(segment: TextSegment) -> bool:
            nonlocal used_chars
            if segment.type == "sentence" or not segment.text or segment.id in seen_segment_ids:
                return False
            prompt_text = self.excerpt_for_prompt(segment, question, segment_excerpt_chars)
            if selected_segments and used_chars + len(prompt_text) > char_budget:
                return False
            selected_segments.append(segment)
            seen_segment_ids.add(segment.id)
            used_chars += len(prompt_text)
            return True

        if prefer_full_context:
            for segment in self._ordered_prompt_segments(segments):
                add_segment(segment)
                if len(selected_segments) >= max_segments_in_prompt:
                    break

        for doc in retrieved_docs or []:
            if not doc.page_content:
                continue
            metadata_segment_id = str((doc.metadata or {}).get("segment_id") or "")
            if metadata_segment_id and metadata_segment_id in segment_map:
                add_segment(segment_map[metadata_segment_id])
                if len(selected_segments) >= max_segments_in_prompt:
                    break
                continue

            clean_doc_content = clean_text_encoding(doc.page_content)
            for segment in segments:
                if segment.type == "sentence" or not segment.text or segment.id in seen_segment_ids:
                    continue
                segment_text = clean_text_encoding(segment.text)
                if segment_text in clean_doc_content or clean_doc_content in segment_text:
                    add_segment(segment)
                    if len(selected_segments) >= max_segments_in_prompt:
                        break
            if len(selected_segments) >= max_segments_in_prompt:
                break

        if not selected_segments:
            for segment in self._ordered_prompt_segments(segments):
                add_segment(segment)
                if len(selected_segments) >= max_segments_in_prompt:
                    break

        return selected_segments[:max_segments_in_prompt]

    def retrieval_hints(self, retrieved_docs: List[Document], max_docs: int) -> str:
        lines = []
        for index, doc in enumerate((retrieved_docs or [])[:max_docs], start=1):
            metadata = doc.metadata or {}
            lines.append(
                f"Rank {index}: Source={metadata.get('source', 'Unknown')} | "
                f"Segment={metadata.get('segment_id', 'matched above')} | "
                f"Level={metadata.get('chunk_level', 'N/A')} | "
                f"Section={metadata.get('section_path', 'N/A')} | "
                f"RRF={metadata.get('rrf_score', 'N/A')}"
            )
        return "\n".join(lines) if lines else "No vector context was available; use the available source segments."

    def excerpt_for_prompt(self, segment: TextSegment, question: str, max_chars: Optional[int]) -> str:
        text = re.sub(r"\s+", " ", clean_text_encoding(segment.text or "")).strip()
        max_chars = max(400, max_chars or getattr(settings, "retriever_segment_excerpt_chars", 1200))
        if max_chars and len(text) > max_chars:
            lowered = text.lower()
            best_index = -1
            for term in self._query_terms(question):
                if len(term) < 4:
                    continue
                term_index = lowered.find(term)
                if term_index >= 0 and (best_index < 0 or term_index < best_index):
                    best_index = term_index
            if best_index >= 0:
                half_window = max_chars // 2
                start = max(0, best_index - half_window)
                end = min(len(text), start + max_chars)
                if end - start < max_chars:
                    start = max(0, end - max_chars)
                prefix = "... " if start > 0 else ""
                suffix = " ..." if end < len(text) else ""
                return prefix + text[start:end].strip() + suffix
            return text[:max_chars].rstrip() + " ..."
        return text

    def _ordered_prompt_segments(self, segments: List[TextSegment]) -> List[TextSegment]:
        meso_segments = [
            segment for segment in segments
            if (segment.chunk_level or segment.type or "").lower() == "meso" and segment.text
        ]
        candidates = meso_segments or [
            segment for segment in segments
            if segment.type != "sentence" and segment.text
        ]
        return sorted(
            candidates,
            key=lambda segment: (
                segment.contract_name or "",
                segment.page_number if segment.page_number is not None else 10_000,
                segment.start_index,
            ),
        )

    def _query_terms(self, question: str) -> List[str]:
        raw_terms = re.findall(r"[a-z0-9][a-z0-9._%$-]+", (question or "").lower())
        stop_words = {
            "about",
            "across",
            "after",
            "also",
            "between",
            "contract",
            "contracts",
            "document",
            "documents",
            "does",
            "from",
            "have",
            "into",
            "this",
            "that",
            "their",
            "there",
            "what",
            "when",
            "where",
            "which",
            "with",
        }
        return [term for term in raw_terms if len(term) > 2 and term not in stop_words]
