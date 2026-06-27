"""Lightweight contract-agent runner.

The runner intentionally stays small: it plans task mode, records tool/evidence
trace data, delegates stable retrieval/indexing to the legacy-compatible
facade, and relies on compact conditional prompts for synthesis.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from utils.secure_logger import log_exception

from .harness import ContractAgentHarness, DOCUMENT_COVERAGE_FALLBACK_USED, EVIDENCE_FALLBACK_USED
from .llm_client import StructuredLLMClient
from .prompts import ContractPromptBuilder, ContractTaskType, detect_task_type
from .retrieval import EvidenceToolbox
from .schemas import TextSegment
from .verifier import ContractAnswerVerifier


@dataclass
class EvidenceLoopResult:
    segments: List[TextSegment]
    observations: List[Dict[str, Any]]
    iterations: int
    tools_used: List[str]
    fallback_reason: Optional[str] = None


class ContractEvidenceLoop:
    """Bounded provider-neutral tool loop for evidence selection."""

    ALLOWED_TOOLS = {
        "list_documents",
        "outline_document",
        "search_evidence",
        "get_kpi_context",
        "calculate_from_evidence",
        "final_answer",
    }

    def __init__(self, owner: Any, *, max_steps: int = 3):
        self.owner = owner
        self.max_steps = max_steps
        self.tools = EvidenceToolbox(owner)
        self.prompt_builder = ContractPromptBuilder()
        self.llm_client = StructuredLLMClient(owner)
        self.verifier = ContractAnswerVerifier()
        self.harness = ContractAgentHarness(owner, verifier=self.verifier)

    def run(
        self,
        *,
        question: str,
        task_type: ContractTaskType,
        all_segments: List[TextSegment],
        initial_segments: List[TextSegment],
        memory_context: str,
        max_segments: int,
    ) -> EvidenceLoopResult:
        if not hasattr(self.owner, "_query_plain_markdown"):
            return EvidenceLoopResult(
                segments=initial_segments,
                observations=[],
                iterations=0,
                tools_used=[],
                fallback_reason="plain model client unavailable",
            )

        selected_by_id: Dict[str, TextSegment] = {segment.id: segment for segment in initial_segments}
        observations: List[Dict[str, Any]] = []
        tools_used: List[str] = []
        document_inventory = self.tools.list_documents(all_segments)
        fallback_reason = None

        for step in range(self.max_steps):
            prompt = self.prompt_builder.build_tool_action_prompt(
                question=question,
                task_type=task_type,
                document_inventory=document_inventory,
                current_evidence=self._evidence_summaries(list(selected_by_id.values())),
                tool_observations=observations,
                memory_context=memory_context,
                remaining_steps=self.max_steps - step,
            )
            try:
                action = self.llm_client.query_tool_action(prompt)
            except Exception as exc:
                loop_logger = getattr(self.owner, "logger", None) or logging.getLogger(__name__)
                log_exception(loop_logger, "Contract evidence loop planner failed", exc)
                fallback_reason = "planner call failed"
                break

            tool_name = str(action.get("tool") or "").strip()
            if tool_name not in self.ALLOWED_TOOLS:
                observations.append({"tool": tool_name or "unknown", "error": "unknown tool requested"})
                fallback_reason = "planner requested unknown tool"
                break
            if tool_name == "final_answer":
                tools_used.append(tool_name)
                ordered_segments = self._ordered_selected_segments(selected_by_id, initial_segments, max_segments)
                decision = self.harness.evaluate_final_answer(
                    task_type=task_type,
                    selected_segments=ordered_segments,
                    all_segments=all_segments,
                    question=question,
                )
                if decision.allowed:
                    observations.append({
                        "tool": "final_answer",
                        "result": decision.reason,
                        "metadata": decision.metadata,
                    })
                    return EvidenceLoopResult(
                        segments=ordered_segments,
                        observations=observations,
                        iterations=step + 1,
                        tools_used=tools_used,
                    )
                observations.append({
                    "tool": "final_answer",
                    "result": decision.reason,
                    "metadata": decision.metadata,
                })
                fallback_reason = decision.reason
                break

            args = action.get("args") if isinstance(action.get("args"), dict) else {}
            result, segment_ids = self._execute_tool(tool_name, args, all_segments, memory_context)
            tools_used.append(tool_name)
            for segment_id in segment_ids:
                segment = self._segment_by_id(all_segments, segment_id)
                if segment:
                    selected_by_id[segment.id] = segment
            observations.append({
                "tool": tool_name,
                "args": args,
                "result": result,
            })
            if len(selected_by_id) >= max_segments:
                break

        ordered_segments = self._ordered_selected_segments(selected_by_id, initial_segments, max_segments)
        fallback_decision = self.harness.evaluate_final_answer(
            task_type=task_type,
            selected_segments=ordered_segments,
            all_segments=all_segments,
            question=question,
        )
        if not fallback_decision.allowed:
            coverage_result, coverage_segment_ids = self._document_coverage_fallback(
                question=question,
                task_type=task_type,
                all_segments=all_segments,
                selected_segments=ordered_segments,
                max_segments=max_segments,
            )
            if coverage_segment_ids:
                tools_used.append("search_evidence")
                observations.append({
                    "tool": "search_evidence",
                    "args": {
                        "query": question,
                        "document_scope": "missing_compare_documents",
                    },
                    "result": coverage_result,
                    "reason": DOCUMENT_COVERAGE_FALLBACK_USED,
                    "metadata": fallback_decision.metadata,
                })
                for segment_id in coverage_segment_ids:
                    segment = self._segment_by_id(all_segments, segment_id)
                    if segment:
                        selected_by_id[segment.id] = segment
                ordered_segments = self._ordered_selected_segments(selected_by_id, initial_segments, max_segments)
                fallback_decision = self.harness.evaluate_final_answer(
                    task_type=task_type,
                    selected_segments=ordered_segments,
                    all_segments=all_segments,
                    question=question,
                )
                if fallback_reason is None:
                    fallback_reason = DOCUMENT_COVERAGE_FALLBACK_USED

        if not fallback_decision.allowed:
            fallback_args = self.harness.fallback_search_args(question=question, max_segments=max_segments)
            result, segment_ids = self._execute_tool(
                "search_evidence",
                fallback_args,
                all_segments,
                memory_context,
            )
            tools_used.append("search_evidence")
            observations.append({
                "tool": "search_evidence",
                "args": fallback_args,
                "result": result,
                "reason": EVIDENCE_FALLBACK_USED,
                "metadata": fallback_decision.metadata,
            })
            for segment_id in segment_ids:
                segment = self._segment_by_id(all_segments, segment_id)
                if segment:
                    selected_by_id[segment.id] = segment
            ordered_segments = self._ordered_selected_segments(selected_by_id, initial_segments, max_segments)
            if fallback_reason is None:
                fallback_reason = EVIDENCE_FALLBACK_USED

        return EvidenceLoopResult(
            segments=ordered_segments,
            observations=observations,
            iterations=min(len(tools_used), self.max_steps),
            tools_used=tools_used,
            fallback_reason=fallback_reason,
        )

    def _execute_tool(
        self,
        tool_name: str,
        args: Dict[str, Any],
        all_segments: List[TextSegment],
        memory_context: str,
    ) -> tuple[Any, Set[str]]:
        if tool_name == "list_documents":
            return self.tools.list_documents(all_segments), set()
        if tool_name == "outline_document":
            limit = self._limit(args.get("limit"), default=40, maximum=80)
            return self.tools.outline_document(all_segments, limit=limit), set()
        if tool_name == "search_evidence":
            query = str(args.get("query") or "").strip()
            limit = self._limit(args.get("limit"), default=8, maximum=20)
            result = self.tools.search_evidence(all_segments, query=query, limit=limit)
            return result, {item["segment_id"] for item in result if item.get("segment_id")}
        if tool_name == "get_kpi_context":
            return self.tools.get_kpi_context(memory_context), set()
        if tool_name == "calculate_from_evidence":
            segment_ids = [str(item) for item in args.get("segment_ids") or [] if item]
            text = str(args.get("text") or "")
            if segment_ids:
                text = "\n".join(segment.text for segment in all_segments if segment.id in segment_ids)
            return self.tools.calculate_from_evidence(text), set(segment_ids)
        return {"error": "tool not executable"}, set()

    def _document_coverage_fallback(
        self,
        *,
        question: str,
        task_type: ContractTaskType,
        all_segments: List[TextSegment],
        selected_segments: List[TextSegment],
        max_segments: int,
    ) -> tuple[List[Dict[str, Any]], Set[str]]:
        missing_documents = self.harness.missing_document_keys(
            task_type=task_type,
            selected_segments=selected_segments,
            all_segments=all_segments,
            question=question,
        )
        if not missing_documents:
            return [], set()

        remaining_budget = max(0, max_segments - len(selected_segments))
        if remaining_budget <= 0:
            return [], set()

        selected_ids: Set[str] = set()
        summaries: List[Dict[str, Any]] = []
        for document_key in missing_documents:
            document_segments = [
                segment
                for segment in all_segments
                if self.harness.document_key(segment) == document_key
            ]
            if not document_segments:
                continue
            matches = self.tools.search_evidence(document_segments, query=question, limit=2)
            if not matches:
                fallback_segment = self._first_promptable_segment(document_segments)
                matches = [self.tools._summary(fallback_segment)] if fallback_segment else []
            for item in matches:
                segment_id = item.get("segment_id")
                if not segment_id or segment_id in selected_ids:
                    continue
                selected_ids.add(segment_id)
                summaries.append(item)
                if len(selected_ids) >= remaining_budget:
                    return summaries, selected_ids
        return summaries, selected_ids

    def _first_promptable_segment(self, segments: List[TextSegment]) -> Optional[TextSegment]:
        candidates = [
            segment
            for segment in segments
            if segment.type != "sentence" and (segment.text or "").strip()
        ]
        if not candidates:
            return None
        return sorted(
            candidates,
            key=lambda segment: (
                segment.page_start or segment.page_number or 10_000,
                segment.start_index,
            ),
        )[0]

    def _evidence_summaries(self, segments: List[TextSegment]) -> List[Dict[str, Any]]:
        return [self.tools._summary(segment) for segment in segments[:20]]

    def _ordered_selected_segments(
        self,
        selected_by_id: Dict[str, TextSegment],
        initial_segments: List[TextSegment],
        max_segments: int,
    ) -> List[TextSegment]:
        selected_ids = set(selected_by_id)
        ordered: List[TextSegment] = []
        for segment in initial_segments:
            if segment.id in selected_ids:
                ordered.append(selected_by_id[segment.id])
                selected_ids.remove(segment.id)
        remaining = [
            segment
            for segment in selected_by_id.values()
            if segment.id in selected_ids
        ]
        remaining.sort(key=lambda segment: (
            segment.contract_name or "",
            segment.page_start or segment.page_number or 10_000,
            segment.start_index,
        ))
        return [*ordered, *remaining][:max_segments]

    def _segment_by_id(self, segments: List[TextSegment], segment_id: str) -> Optional[TextSegment]:
        for segment in segments:
            if segment.id == segment_id:
                return segment
        return None

    def _limit(self, value: Any, *, default: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except Exception:
            parsed = default
        return max(1, min(parsed, maximum))
