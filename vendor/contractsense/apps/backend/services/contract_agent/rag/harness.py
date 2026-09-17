"""Runtime harness for the contract agent.

The harness is intentionally small: it owns the control gates around an agent
run, while retrieval, prompts, model calls, and citation validation stay in
their focused modules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .prompts import ContractTaskType
from .schemas import TextSegment
from .verifier import ContractAnswerVerifier


FINAL_SYNTHESIS_ALLOWED = "evidence_sufficient_for_synthesis"
FINAL_SYNTHESIS_BLOCKED = "insufficient_evidence_for_final_answer"
EVIDENCE_FALLBACK_USED = "evidence_sufficiency_fallback_used"
DOCUMENT_COVERAGE_FALLBACK_USED = "document_coverage_fallback_used"


@dataclass
class HarnessDecision:
    allowed: bool
    reason: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def accepted(self) -> bool:
        return self.allowed


class ContractAgentHarness:
    """Guardrails and run-control decisions for the contract agent."""

    def __init__(self, owner: Any = None, *, verifier: Optional[ContractAnswerVerifier] = None):
        self.owner = owner
        self.verifier = verifier or ContractAnswerVerifier()

    def evaluate_final_answer(
        self,
        *,
        task_type: ContractTaskType,
        selected_segments: List[TextSegment],
        all_segments: List[TextSegment],
        question: str,
    ) -> HarnessDecision:
        sufficient = self.verifier.evidence_is_sufficient(
            task_type=task_type,
            selected_segments=selected_segments,
            question=question,
            all_segments=all_segments,
        )
        if sufficient:
            return HarnessDecision(
                allowed=True,
                reason=FINAL_SYNTHESIS_ALLOWED,
                metadata=self._coverage_metadata(selected_segments, all_segments, question, task_type),
            )
        return HarnessDecision(
            allowed=False,
            reason=FINAL_SYNTHESIS_BLOCKED,
            metadata=self._coverage_metadata(selected_segments, all_segments, question, task_type),
        )

    def fallback_search_args(self, *, question: str, max_segments: int) -> Dict[str, Any]:
        return {"query": question, "limit": min(8, max_segments)}

    def missing_document_keys(
        self,
        *,
        task_type: ContractTaskType,
        selected_segments: List[TextSegment],
        all_segments: List[TextSegment],
        question: str,
    ) -> List[str]:
        if task_type != ContractTaskType.COMPARE:
            return []
        available_documents = sorted(self._document_keys(all_segments))
        selected_documents = self._document_keys(selected_segments)
        required_count = self.verifier._required_document_count_for_compare(
            question=question,
            available_document_count=len(available_documents),
        )
        if len(selected_documents) >= required_count:
            return []
        missing_documents = [
            document_key
            for document_key in available_documents
            if document_key not in selected_documents
        ]
        return missing_documents[: max(required_count - len(selected_documents), 0)]

    def document_key(self, segment: TextSegment) -> str:
        return segment.contract_id or segment.contract_name or "document"

    def _coverage_metadata(
        self,
        selected_segments: List[TextSegment],
        all_segments: List[TextSegment],
        question: str,
        task_type: ContractTaskType,
    ) -> Dict[str, Any]:
        selected_documents = self._document_keys(selected_segments)
        available_documents = self._document_keys(all_segments)
        required_document_count = (
            self.verifier._required_document_count_for_compare(
                question=question,
                available_document_count=len(available_documents),
            )
            if task_type == ContractTaskType.COMPARE
            else min(1, len(available_documents))
        )
        return {
            "selected_document_count": len(selected_documents),
            "available_document_count": len(available_documents),
            "required_document_count": required_document_count,
            "selected_documents": sorted(selected_documents),
            "available_documents": sorted(available_documents),
            "selected_segment_count": len(selected_segments),
        }

    def _document_keys(self, segments: List[TextSegment]) -> set[str]:
        return {
            self.document_key(segment)
            for segment in segments
            if segment.text
        }
