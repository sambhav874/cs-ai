"""Answer verification and evidence sufficiency checks for the contract agent."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from utils.text_cleanup import clean_text_encoding

from .prompts import ContractTaskType
from .schemas import ExtractedAnswer, Reference, TextSegment


SILENCE_PHRASES = (
    "does not address",
    "not addressed",
    "does not explicitly",
    "not explicitly",
    "not found",
    "could not find",
    "no indexed",
    "no source",
    "no evidence",
)

EVIDENCE_TERM_STOP_WORDS = {
    "about",
    "after",
    "again",
    "against",
    "agreement",
    "also",
    "answer",
    "between",
    "clause",
    "contract",
    "contracts",
    "document",
    "documents",
    "from",
    "have",
    "into",
    "material",
    "section",
    "shall",
    "should",
    "that",
    "their",
    "there",
    "this",
    "under",
    "what",
    "when",
    "where",
    "which",
    "with",
}

SOURCE_EXACT_VALUE_PATTERNS = (
    re.compile(
        r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:below|above|under|over|at least|at most|less than|greater than|no more than|not less than)\s+\d+(?:\.\d+)?\s*[A-Za-z%]+\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b\d+(?:\.\d+)?%"),
    re.compile(r"\b(?:USD|EUR|GBP|INR)\s+\d[\d,]*(?:\.\d+)?\b", re.IGNORECASE),
    re.compile(r"\b\d+(?:\.\d+)?\s+(?:business\s+days|calendar\s+days|days|months|years|hours)\b", re.IGNORECASE),
)


@dataclass
class VerificationResult:
    answer: ExtractedAnswer
    issues: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.issues


class ContractAnswerVerifier:
    """Small verifier for structured contract answers."""

    def verify(
        self,
        *,
        answer: ExtractedAnswer,
        segment_map: Dict[str, TextSegment],
        task_type: ContractTaskType,
        memory_context: str = "",
    ) -> VerificationResult:
        issues: List[str] = []
        value = clean_text_encoding(answer.value or "")
        value = self._remove_segment_id_leaks(value, segment_map.keys(), issues)

        raw_segment_ids = answer.reference.segment_ids if answer.reference else []
        valid_segment_ids = [
            segment_id
            for segment_id in raw_segment_ids
            if isinstance(segment_id, str) and segment_id in segment_map
        ]
        if len(valid_segment_ids) != len(raw_segment_ids):
            issues.append("invalid_segment_ids_removed")

        markers = self._marker_refs(value)
        valid_marker_refs = {ref for ref in markers if 1 <= ref <= len(valid_segment_ids)}
        if markers and len(valid_marker_refs) != len(set(markers)):
            value = self._remove_invalid_markers(value, len(valid_segment_ids))
            issues.append("invalid_citation_markers_removed")

        if valid_segment_ids and not self._marker_refs(value):
            value = f"{value.rstrip()} [1]".strip()
            issues.append("missing_citation_marker_added")

        if task_type == ContractTaskType.QA and self._is_silence_answer(value):
            value, valid_segment_ids, added_silence_citations = self._append_relevant_silence_citation(
                value=value,
                answer_question=answer.question,
                valid_segment_ids=valid_segment_ids,
                segment_map=segment_map,
            )
            if added_silence_citations:
                issues.append("silence_citation_added")

        trust_boundary = self._is_trust_boundary_answer(
            answer_question=answer.question,
            value=value,
            valid_segment_ids=valid_segment_ids,
            segment_map=segment_map,
        )
        if trust_boundary:
            value, valid_segment_ids, added_request_citations = self._append_trust_boundary_request_citation(
                value=value,
                valid_segment_ids=valid_segment_ids,
                segment_map=segment_map,
            )
            if added_request_citations:
                issues.append("trust_boundary_request_citation_added")
            value, appended_governing_phrases = self._append_trust_boundary_governing_phrase(
                value=value,
                valid_segment_ids=valid_segment_ids,
                segment_map=segment_map,
            )
            if appended_governing_phrases:
                issues.append("trust_boundary_governing_phrase_appended")
            value, scrubbed_values = self._scrub_confidential_source_values(
                value=value,
                valid_segment_ids=valid_segment_ids,
                segment_map=segment_map,
            )
            if scrubbed_values:
                issues.append("confidential_values_scrubbed")

        preserve_source_values = task_type in {ContractTaskType.DRAFT, ContractTaskType.REDLINE, ContractTaskType.KPI} or (
            task_type == ContractTaskType.QA and not self._is_silence_answer(value) and not trust_boundary
        )
        if valid_segment_ids and preserve_source_values:
            value, appended_exact_values = self._append_missing_source_exact_values(
                value=value,
                valid_segment_ids=valid_segment_ids,
                segment_map=segment_map,
            )
            if appended_exact_values:
                issues.append("source_exact_values_appended")

        if task_type == ContractTaskType.KPI and memory_context:
            value, appended_kpi_values = self._append_missing_kpi_register_values(
                value=value,
                memory_context=memory_context,
            )
            if appended_kpi_values:
                issues.append("kpi_register_values_appended")

        if self._requires_evidence(task_type, value) and not valid_segment_ids:
            issues.append("insufficient_cited_evidence")
        if (
            self._requires_citation_support_check(task_type, value)
            and valid_segment_ids
            and not self._citation_supports_answer(value, valid_segment_ids, segment_map)
        ):
            issues.append("weak_citation_support")

        confidence = str(answer.confidence or "low").lower()
        if confidence not in {"high", "medium", "low"}:
            confidence = "low"
            issues.append("confidence_normalized")
        if "insufficient_cited_evidence" in issues or "weak_citation_support" in issues:
            confidence = "low"

        justification = clean_text_encoding(answer.reference.justification if answer.reference else "")
        if issues:
            issue_text = ", ".join(issues)
            justification = f"{justification} Verification: {issue_text}.".strip()

        verified = ExtractedAnswer(
            question=answer.question,
            value=value,
            reference=Reference(
                segment_ids=valid_segment_ids,
                justification=justification or "Verified against cited contract evidence.",
                confidence=confidence,
            ),
            confidence=confidence,
        )
        return VerificationResult(answer=verified, issues=issues)

    def evidence_is_sufficient(
        self,
        *,
        task_type: ContractTaskType,
        selected_segments: List[TextSegment],
        question: str,
        all_segments: Optional[List[TextSegment]] = None,
    ) -> bool:
        if task_type == ContractTaskType.DRAFT:
            return bool(selected_segments)
        if not selected_segments:
            return False
        if task_type == ContractTaskType.COMPARE:
            available_documents = self._document_keys(all_segments or selected_segments)
            selected_documents = self._document_keys(selected_segments)
            required_document_count = self._required_document_count_for_compare(
                question=question,
                available_document_count=len(available_documents),
            )
            if len(available_documents) > 1 and len(selected_documents) < required_document_count:
                return False
        question_terms = self._evidence_terms(question)
        if not question_terms:
            return True
        evidence_text = " ".join((segment.text or "").lower() for segment in selected_segments[:12])
        return any(term in evidence_text for term in question_terms)

    def _required_document_count_for_compare(self, *, question: str, available_document_count: int) -> int:
        if available_document_count <= 1:
            return available_document_count
        normalized_question = (question or "").lower()
        asks_for_full_coverage = bool(
            re.search(r"\b(all|each|every|across|compare|comparison|between)\b", normalized_question)
        )
        if asks_for_full_coverage and available_document_count <= 8:
            return available_document_count
        return min(2, available_document_count)

    def _document_keys(self, segments: List[TextSegment]) -> Set[str]:
        return {
            segment.contract_id or segment.contract_name or "document"
            for segment in segments
            if segment.text
        }

    def _requires_evidence(self, task_type: ContractTaskType, value: str) -> bool:
        if task_type == ContractTaskType.DRAFT:
            return False
        lowered = value.lower()
        return not any(phrase in lowered for phrase in SILENCE_PHRASES)

    def _is_silence_answer(self, value: str) -> bool:
        lowered = (value or "").lower()
        return any(phrase in lowered for phrase in SILENCE_PHRASES)

    def _requires_citation_support_check(self, task_type: ContractTaskType, value: str) -> bool:
        if task_type in {ContractTaskType.DRAFT, ContractTaskType.REDLINE}:
            return False
        return self._requires_evidence(task_type, value)

    def _citation_supports_answer(
        self,
        value: str,
        valid_segment_ids: List[str],
        segment_map: Dict[str, TextSegment],
    ) -> bool:
        answer_terms = self._evidence_terms(self._remove_citation_markers(value))
        if not answer_terms:
            return True
        evidence_terms = self._evidence_terms(
            " ".join(segment_map[segment_id].text for segment_id in valid_segment_ids if segment_id in segment_map)
        )
        if not evidence_terms:
            return False
        overlap = answer_terms & evidence_terms
        required_overlap = 1 if len(answer_terms) <= 3 else 2
        overlap_ratio = len(overlap) / max(len(answer_terms), 1)
        return len(overlap) >= required_overlap or overlap_ratio >= 0.2

    def _remove_citation_markers(self, value: str) -> str:
        return re.sub(r"\[(\d+(?:\s*,\s*\d+)*)\]", " ", value or "")

    def _append_relevant_silence_citation(
        self,
        *,
        value: str,
        answer_question: str,
        valid_segment_ids: List[str],
        segment_map: Dict[str, TextSegment],
    ) -> Tuple[str, List[str], List[str]]:
        if not valid_segment_ids or len(valid_segment_ids) >= 3:
            return value, valid_segment_ids, []
        question_terms = self._evidence_terms(answer_question)
        if not question_terms:
            return value, valid_segment_ids, []
        cited = set(valid_segment_ids)
        best_segment_id = ""
        best_rank = (0, 0, 0, 0)
        for segment_id, segment in segment_map.items():
            if segment_id in cited or not segment.text:
                continue
            haystack = f"{segment.section_path or ''} {segment.text or ''}".lower()
            score = 0
            for term in question_terms:
                if term in haystack:
                    score += 3
                elif len(term) >= 6 and term[:6] in haystack:
                    score += 1
            if not score:
                continue
            level = (segment.chunk_level or segment.type or "").lower()
            level_bonus = 2 if level == "meso" else 1 if level not in {"macro", "sentence"} else 0
            section_text = (segment.section_path or "").lower()
            section_bonus = 1 if any(term in section_text or (len(term) >= 6 and term[:6] in section_text) for term in question_terms) else 0
            rank = (score, level_bonus, section_bonus, -len(segment.text or ""))
            if rank > best_rank:
                best_rank = rank
                best_segment_id = segment_id
        if not best_segment_id:
            return value, valid_segment_ids, []

        repaired_segment_ids = [*valid_segment_ids, best_segment_id]
        next_marker = len(repaired_segment_ids)
        repaired_value = f"{value.rstrip()} [{next_marker}]".strip()
        return repaired_value, repaired_segment_ids, [best_segment_id]

    def _append_trust_boundary_governing_phrase(
        self,
        *,
        value: str,
        valid_segment_ids: List[str],
        segment_map: Dict[str, TextSegment],
    ) -> Tuple[str, List[str]]:
        if "must not be disclosed" in (value or "").lower():
            return value, []
        for ref_index, segment_id in enumerate(valid_segment_ids, start=1):
            segment = segment_map.get(segment_id)
            if not segment:
                continue
            if "must not be disclosed" not in (segment.text or "").lower():
                continue
            suffix = f"Governing restriction: confidential material must not be disclosed [{ref_index}]."
            return f"{value.rstrip()} {suffix}".strip(), ["must not be disclosed"]
        return value, []

    def _is_trust_boundary_answer(
        self,
        *,
        answer_question: str,
        value: str,
        valid_segment_ids: List[str],
        segment_map: Dict[str, TextSegment],
    ) -> bool:
        cited_text = " ".join(
            segment_map[segment_id].text
            for segment_id in valid_segment_ids
            if segment_id in segment_map
        )
        text = f"{answer_question} {value} {cited_text}".lower()
        has_disclosure_context = bool(
            re.search(r"\b(vendor|third part(?:y|ies)|untrusted|ignore .*rules|send|disclos|share|forward)\b", text)
        )
        return has_disclosure_context and "confidential" in text

    def _append_trust_boundary_request_citation(
        self,
        *,
        value: str,
        valid_segment_ids: List[str],
        segment_map: Dict[str, TextSegment],
    ) -> Tuple[str, List[str], List[str]]:
        cited = set(valid_segment_ids)
        if any(
            self._segment_looks_like_untrusted_request(segment_map[segment_id])
            for segment_id in valid_segment_ids
            if segment_id in segment_map
        ):
            return value, valid_segment_ids, []

        best_segment_id = ""
        best_rank = (0, 0, 0)
        for segment_id, segment in segment_map.items():
            if segment_id in cited or not segment.text:
                continue
            haystack = f"{segment.contract_id or ''} {segment.contract_name or ''} {segment.section_path or ''} {segment.text or ''}".lower()
            score = sum(1 for term in ("vendor", "request", "email", "ignore", "send", "approval") if term in haystack)
            if not score:
                continue
            level = (segment.chunk_level or segment.type or "").lower()
            level_bonus = 2 if level == "meso" else 1 if level not in {"macro", "sentence"} else 0
            rank = (score, level_bonus, -len(segment.text or ""))
            if rank > best_rank:
                best_rank = rank
                best_segment_id = segment_id
        if not best_segment_id:
            return value, valid_segment_ids, []
        repaired_segment_ids = [*valid_segment_ids, best_segment_id]
        next_marker = len(repaired_segment_ids)
        repaired_value = f"{value.rstrip()} [{next_marker}]".strip()
        return repaired_value, repaired_segment_ids, [best_segment_id]

    def _segment_looks_like_untrusted_request(self, segment: TextSegment) -> bool:
        text = f"{segment.contract_id or ''} {segment.contract_name or ''} {segment.section_path or ''} {segment.text or ''}".lower()
        return bool(re.search(r"\b(vendor|forwarded|request|email|ignore .*confidential|ignore .*rules)\b", text))

    def _scrub_confidential_source_values(
        self,
        *,
        value: str,
        valid_segment_ids: List[str],
        segment_map: Dict[str, TextSegment],
    ) -> Tuple[str, List[str]]:
        scrubbed: List[str] = []
        cleaned = value
        for segment_id in valid_segment_ids:
            segment = segment_map.get(segment_id)
            if not segment or self._segment_is_governing_or_request(segment):
                continue
            for exact_value in self._source_exact_values(segment.text or ""):
                if not re.search(r"\d", exact_value):
                    continue
                pattern = re.compile(re.escape(exact_value), flags=re.IGNORECASE)
                if not pattern.search(cleaned):
                    continue
                cleaned = pattern.sub("[confidential value]", cleaned)
                scrubbed.append(exact_value)
        return cleaned, scrubbed

    def _segment_is_governing_or_request(self, segment: TextSegment) -> bool:
        text = f"{segment.section_path or ''} {segment.text or ''}".lower()
        if self._segment_looks_like_untrusted_request(segment):
            return True
        return "must not be disclosed" in text or "confidentiality" in text and "authorizes disclosure" in text

    def _append_missing_source_exact_values(
        self,
        *,
        value: str,
        valid_segment_ids: List[str],
        segment_map: Dict[str, TextSegment],
    ) -> Tuple[str, List[str]]:
        missing_values: List[Tuple[str, int]] = []
        answer_lower = (value or "").lower()
        seen = set()
        for ref_index, segment_id in enumerate(valid_segment_ids, start=1):
            segment = segment_map.get(segment_id)
            if not segment:
                continue
            for exact_value in self._source_exact_values(segment.text or ""):
                normalized = exact_value.lower()
                if normalized in answer_lower or normalized in seen:
                    continue
                seen.add(normalized)
                missing_values.append((exact_value, ref_index))
                if len(missing_values) >= 6:
                    break
            if len(missing_values) >= 6:
                break
        if not missing_values:
            return value, []

        suffix = "Source-exact values: " + "; ".join(
            f"{exact_value} [{ref_index}]"
            for exact_value, ref_index in missing_values
        ) + "."
        return f"{value.rstrip()} {suffix}".strip(), [exact_value for exact_value, _ in missing_values]

    def _source_exact_values(self, text: str) -> List[str]:
        matches: List[Tuple[int, str]] = []
        for pattern in SOURCE_EXACT_VALUE_PATTERNS:
            for match in pattern.finditer(clean_text_encoding(text or "")):
                exact_value = re.sub(r"\s+", " ", match.group(0)).strip()
                if exact_value:
                    matches.append((match.start(), exact_value))
        ordered_values: List[str] = []
        seen = set()
        for _position, exact_value in sorted(matches, key=lambda item: item[0]):
            normalized = exact_value.lower()
            if normalized in seen:
                continue
            seen.add(normalized)
            ordered_values.append(exact_value)
        return ordered_values

    def _append_missing_kpi_register_values(self, *, value: str, memory_context: str) -> Tuple[str, List[str]]:
        if "kpi register:" not in (memory_context or "").lower():
            return value, []

        answer_lower = (value or "").lower()
        appended: List[str] = []
        seen = set()
        for field_name, pattern in (
            ("actual", r"\bactual(?:_value)?\s*=\s*([^;\n]+)"),
            ("threshold", r"\bthreshold\s*=\s*([^;\n]+)"),
            ("status", r"\bstatus\s*=\s*([^;\n]+)"),
        ):
            for match in re.finditer(pattern, memory_context or "", flags=re.IGNORECASE):
                exact_value = re.sub(r"\s+", " ", match.group(1)).strip(" .")
                if not exact_value:
                    continue
                exact_field = f"{field_name}={exact_value}"
                normalized = exact_field.lower()
                if self._contains_exact_phrase(answer_lower, exact_value) or normalized in seen:
                    continue
                seen.add(normalized)
                appended.append(exact_field)
                break

        if not appended:
            return value, []
        suffix = "KPI-register values: " + "; ".join(appended) + "."
        return f"{value.rstrip()} {suffix}".strip(), appended

    def _contains_exact_phrase(self, answer_lower: str, exact_value: str) -> bool:
        phrase = re.escape((exact_value or "").lower())
        if not phrase:
            return True
        return bool(re.search(rf"(?<![a-z0-9]){phrase}(?![a-z0-9])", answer_lower or ""))

    def _evidence_terms(self, text: str) -> Set[str]:
        return {
            term.lower()
            for term in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text or "")
            if term.lower() not in EVIDENCE_TERM_STOP_WORDS
        }

    def _remove_segment_id_leaks(self, value: str, segment_ids: Set[str], issues: List[str]) -> str:
        cleaned = value
        for segment_id in sorted(segment_ids, key=len, reverse=True):
            if segment_id and segment_id in cleaned:
                cleaned = cleaned.replace(segment_id, "").strip()
                issues.append("segment_id_removed_from_visible_answer")
        cleaned = re.sub(r"\s{2,}", " ", cleaned)
        cleaned = re.sub(r"\(\s*\)", "", cleaned)
        return cleaned

    def _marker_refs(self, value: str) -> List[int]:
        refs: List[int] = []
        for match in re.finditer(r"\[(\d+(?:\s*,\s*\d+)*)\]", value or ""):
            refs.extend(
                int(part.strip())
                for part in match.group(1).split(",")
                if part.strip().isdigit()
            )
        return refs

    def _remove_invalid_markers(self, value: str, citation_count: int) -> str:
        def replace(match: re.Match[str]) -> str:
            refs = [
                int(part.strip())
                for part in match.group(1).split(",")
                if part.strip().isdigit()
            ]
            valid_refs = [str(ref) for ref in refs if 1 <= ref <= citation_count]
            return f"[{', '.join(valid_refs)}]" if valid_refs else ""

        return re.sub(r"\[(\d+(?:\s*,\s*\d+)*)\]", replace, value)
