"""Eval runner that executes cases through the real agent loop.

`CoreContractSenseRunner` in runners.py drives `ContractRAGSystem` — the legacy
path that production no longer reaches (F-12) and that Phase 3.4 deletes. It is
kept for the side-by-side comparison that deletion needs, but it cannot gate
Phase 1: 1.2, 1.3, 1.4 and 1.5 all change `react_runtime.py`, and the core runner
never executes a line of it.

This runner goes through `DeepContractAgentRunner`, so the loop, the middleware
guard layer, and the citation pipeline are all under test. Retrieval is served
from the fixture documents by an injected `tool_executor` rather than Mongo +
Voyage, which keeps the gate hermetic: the only external dependency is the model
API. Retrieval quality is explicitly out of scope for this sprint, so a
deterministic lexical retriever over known fixture text is the right substitute —
it makes tool *selection* and citation *support* the things being measured.

Multi-turn cases run each turn on one session and compose a `memory_context`
between turns in the same shape `AgentMemoryManager.build_memory_context`
produces, so the 0.3 plumbing is what carries the reference forward.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from services.memory import MemoryComposer, MemoryScope, recent_turns_block

from .schema import AgentEvalObservation, ContractSenseEvalCase, EvalDocument


# Mirrors agent_memory.RECENT_MESSAGE_LIMIT semantics closely enough for a short
# eval session; every turn stays in the window at these sizes.
RECENT_TURN_LIMIT = 12


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _tokens(text: str) -> List[str]:
    return [
        token
        for token in re.findall(r"[a-z][a-z0-9_$%.-]{2,}", (text or "").lower())
        if token not in _STOP
    ]


_STOP = {
    "and", "are", "for", "from", "has", "have", "into", "its", "not", "our",
    "shall", "such", "than", "that", "the", "their", "this", "under", "was",
    "were", "what", "which", "will", "with", "does", "say", "said",
}


def _parts_report(prompt: str, answer: str) -> Dict[str, Any]:
    from services.contract_agent import citations as citation_pipeline
    from services.contract_agent.question_plan import missing_parts, split_parts

    parts = split_parts(prompt)
    if not parts:
        return {}
    return {
        "question_parts": len(parts),
        "missing_parts": missing_parts(parts, citation_pipeline.strip_citation_block(answer)),
    }


class FixtureRetriever:
    """Deterministic lexical retrieval over the sections of one eval case.

    Scores each section by content-token overlap with the query. No embeddings,
    no reranker — those are a different sprint, and a stable retriever is what
    makes a citation-support regression attributable to the citation pipeline
    rather than to retrieval drift.
    """

    def __init__(self, documents: Sequence[EvalDocument]):
        self.documents = list(documents)
        self._sections: List[Dict[str, Any]] = []
        for document in self.documents:
            for position, section in enumerate(document.sections, start=1):
                self._sections.append(
                    {
                        "document_id": document.document_id,
                        "filename": document.filename,
                        "ref": section.ref,
                        "title": section.title,
                        "text": section.text,
                        "page": position,
                        "tokens": set(_tokens(f"{section.title} {section.ref} {section.text}")),
                    }
                )

    def search(
        self,
        query: str,
        *,
        document_ids: Optional[Sequence[str]] = None,
        top_k: int = 12,
        must_contain: Sequence[str] = (),
    ) -> List[Dict[str, Any]]:
        query_tokens = set(_tokens(query))
        allowed = {str(item) for item in (document_ids or []) if item}
        scored: List[Tuple[float, Dict[str, Any]]] = []
        for section in self._sections:
            if allowed and section["document_id"] not in allowed:
                continue
            if must_contain and not all(
                normalize(term) in normalize(section["text"]) for term in must_contain if term
            ):
                continue
            if not query_tokens:
                score = 0.5
            else:
                overlap = query_tokens & section["tokens"]
                score = len(overlap) / len(query_tokens)
                if normalize(section["ref"]) and normalize(section["ref"]) in normalize(query):
                    score += 1.0
            if score <= 0:
                continue
            scored.append((score, section))

        scored.sort(key=lambda item: (-item[0], item[1]["ref"]))
        return [self._as_match(section, index) for index, (_, section) in enumerate(scored[:top_k], start=1)]

    def _as_match(self, section: Dict[str, Any], index: int) -> Dict[str, Any]:
        return {
            "evidence_id": f"{section['document_id']}::{section['ref']}",
            "segment_id": f"{section['document_id']}::{section['ref']}",
            "document_id": section["document_id"],
            "doc_id": section["document_id"],
            "filename": section["filename"],
            "page": section["page"],
            "page_start": section["page"],
            "page_end": section["page"],
            "section_ref": section["ref"],
            "quote": section["text"],
            "context": section["text"],
            "snippet": section["text"],
            "rank": index,
        }

    def document(self, document_id: str = "") -> Optional[EvalDocument]:
        if document_id:
            for document in self.documents:
                if document.document_id == document_id:
                    return document
        return self.documents[0] if self.documents else None

    def full_text(self, document: EvalDocument) -> str:
        parts = [f"Document: {document.filename}"]
        for position, section in enumerate(document.sections, start=1):
            parts.append(f"--- Page {position} ---")
            parts.append(f"{section.ref} {section.title}".strip())
            parts.append(section.text)
        return "\n".join(parts)


def build_fixture_tool_executor(case: ContractSenseEvalCase):
    """Return a `(record, state) -> observation` executor over the case fixtures.

    Matches the observation shapes the real executor emits — `matches` lists for
    retrieval, `search_results` prose for the model, `outline` for coverage —
    because `react_runtime` and `middleware` both key off those exact keys when
    they build and validate citations.
    """
    retriever = FixtureRetriever(case.documents)

    def executor(record, state) -> Dict[str, Any]:
        name = record.name
        args = dict(record.args or {})

        if name in {"list_documents", "fetch_documents"}:
            return {
                "summary": f"{len(retriever.documents)} scoped document(s).",
                "documents": [
                    {"document_id": document.document_id, "filename": document.filename, "status": "Indexed"}
                    for document in retriever.documents
                ],
            }

        if name in {"search_evidence", "find_in_document"}:
            query = str(args.get("query") or args.get("term") or state.message or "")
            extra = args.get("queries") or []
            if isinstance(extra, list):
                query = " ".join([query, *[str(item) for item in extra]])
            must_contain = args.get("must_contain") or []
            if isinstance(must_contain, str):
                must_contain = [must_contain]
            document_ids = args.get("document_ids") or args.get("document_id") or []
            if isinstance(document_ids, str):
                document_ids = [document_ids] if document_ids else []
            matches = retriever.search(
                query,
                document_ids=document_ids or state.context.selected_document_ids,
                top_k=int(args.get("top_k") or 12),
                must_contain=[str(item) for item in must_contain],
            )
            if not matches:
                return {"summary": "No contract sections matched the query.", "matches": []}
            return {
                "summary": f"{len(matches)} evidence snippet(s) retrieved.",
                "matches": matches,
                "search_results": "\n\n".join(
                    "[{rank}] {filename} p.{page} ({ref})\nEvidence ID: {eid}\n{quote}".format(
                        rank=match["rank"],
                        filename=match["filename"],
                        page=match["page"],
                        ref=match["section_ref"],
                        eid=match["evidence_id"],
                        quote=match["quote"],
                    )
                    for match in matches
                ),
            }

        if name == "read_document":
            document = retriever.document(str(args.get("document_id") or ""))
            if document is None:
                return {"summary": "No scoped document to read.", "matches": []}
            text = retriever.full_text(document)
            include_full = bool(args.get("include_full"))
            body = text if include_full else text[: int(args.get("max_chars") or 4000)]
            return {
                "summary": f"Read {document.filename} ({'full' if include_full else 'excerpt'}).",
                "document_id": document.document_id,
                "filename": document.filename,
                "snippet": body,
                "matches": retriever.search("", document_ids=[document.document_id], top_k=50),
            }

        if name == "outline_document":
            document = retriever.document(str(args.get("document_id") or ""))
            if document is None:
                return {"summary": "No scoped document to outline.", "matches": []}
            return {
                "summary": f"Outline of {document.filename}.",
                "document_id": document.document_id,
                "filename": document.filename,
                "outline": "\n".join(
                    f"- {section.ref}: {section.title}" for section in document.sections
                ),
            }

        if name == "get_kpi_context":
            if not case.kpis:
                return {"summary": "No KPI records for this contract.", "matches": []}

            def _kpi_evidence_id(kpi) -> str:
                # A KPI record is derived from a document clause (kpi.refs), so
                # its evidence should anchor to that clause's section ref, the
                # same way real production KPI evidence does (executor.py).
                # Anchoring to a synthetic "kpi::<id>" instead makes any citation
                # of KPI evidence structurally unable to satisfy a fixture's
                # required_citation_refs against the source document.
                doc_id = case.documents[0].document_id if case.documents else ""
                if kpi.refs:
                    return f"{doc_id}::{kpi.refs[0]}"
                return f"kpi::{kpi.kpi_id}"

            return {
                "summary": f"{len(case.kpis)} KPI record(s).",
                "matches": [
                    {
                        "evidence_id": _kpi_evidence_id(kpi),
                        "segment_id": _kpi_evidence_id(kpi),
                        "document_id": case.documents[0].document_id if case.documents else "",
                        "doc_id": case.documents[0].document_id if case.documents else "",
                        "filename": case.documents[0].filename if case.documents else "kpi_register",
                        "page": None,
                        "quote": (
                            f"{kpi.name}: threshold={kpi.threshold}; actual={kpi.actual_value}; "
                            f"status={kpi.status}; refs={', '.join(kpi.refs)}"
                        ),
                        "context": (
                            f"{kpi.name}: threshold={kpi.threshold}; actual={kpi.actual_value}; "
                            f"status={kpi.status}"
                        ),
                    }
                    for kpi in case.kpis
                ],
            }

        if name == "calculate_from_evidence":
            return {
                "summary": "Calculation context recorded; state the arithmetic in the answer.",
                "expression": args.get("expression"),
                "context": args.get("context"),
            }

        return {"summary": f"Tool {name} is not seeded in the eval fixture."}

    return executor


class AgentContractSenseRunner:
    """Runs eval cases through DeepContractAgentRunner, one session per case."""

    def __init__(
        self,
        *,
        ai_provider: Optional[str] = None,
        max_iterations: Optional[int] = None,
        model: Optional[Any] = None,
    ):
        self.ai_provider = ai_provider
        self.max_iterations = max_iterations
        # Injecting a model bypasses build_chat_model, which lets the whole agent
        # path — loop, guards, citation pipeline, metrics — run in CI with no
        # provider key. Real gate runs leave this None.
        self.model = model

    def run_case(self, case: ContractSenseEvalCase, *, attempt: int = 1) -> AgentEvalObservation:
        started = time.time()
        prompts = [case.prompt, *case.follow_up_prompts]
        try:
            from services.contract_agent.graph.runner import DeepContractAgentRunner
            from services.contract_agent.graph.state import (
                AgentContext,
                AgentRunState,
                AgentSurface,
            )

            context = self._context(case, AgentContext, AgentSurface)
            executor = build_fixture_tool_executor(case)
            # The citation guard checks every quote against the cited
            # document's text; here that text is the fixture's sections.
            from services.contract_agent import citations as citation_pipeline

            sources = {
                document.document_id: "\n\n".join(
                    "\n".join(part for part in (section.title, section.text) if part) for section in document.sections
                )
                for document in case.documents
            }
            previous_loader = citation_pipeline.set_source_loader(sources.get)
            transcript: List[Tuple[str, str]] = []

            model_calls = 0
            tool_calls = 0
            input_tokens = 0
            output_tokens = 0
            response = None

            for prompt in prompts:
                state = AgentRunState(
                    user_id="contractsense-eval",
                    message=prompt,
                    context=context,
                    ai_provider=self.ai_provider,
                    memory_context=self._memory_context(case, transcript),
                )
                response = DeepContractAgentRunner(
                    store=None,
                    tool_executor=executor,
                    model=self.model,
                    max_iterations=self.max_iterations,
                ).run(state)

                model_calls += int(getattr(response, "model_calls", 0) or 0)
                tool_calls += len(response.tools or [])
                usage = response.token_usage
                input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
                output_tokens += int(getattr(usage, "output_tokens", 0) or 0)

                transcript.append(("user", prompt))
                transcript.append(("assistant", response.answer or ""))

            citation_pipeline.set_source_loader(previous_loader)
            if response is None:
                raise RuntimeError("case declared no prompts")

            annotations = list(response.citation_annotations or [])
            dropped = list(((response.citation_details or {}).get("citation_guard") or {}).get("dropped") or [])
            answer = response.answer or ""
            latency_ms = int((time.time() - started) * 1000)

            return AgentEvalObservation(
                case_id=case.case_id,
                runner="agent",
                attempt=attempt,
                answer=answer,
                outcome=self._infer_outcome(case, answer),
                citation_refs=self._refs_from_annotations(case, annotations),
                citation_annotations=annotations,
                artifacts=list(response.artifacts or []),
                trace=[
                    {
                        "event": "agent_run",
                        "turns": len(prompts),
                        "latency_ms": latency_ms,
                    },
                    {
                        "event": "agent_trace",
                        "model_calls": model_calls,
                        "tool_calls": tool_calls,
                        "iterations": getattr(response, "react_iterations", None),
                        "citation_count": len(annotations),
                        "tools": list(response.tools_called or []),
                    },
                ],
                latency_ms=latency_ms,
                cost_usd=getattr(response, "cost_usd", None),
                turns=len(prompts),
                model_calls=model_calls,
                tool_calls=tool_calls,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                verified_citations=sum(1 for item in annotations if item.get("verified")),
                emitted_citations=len(annotations) + len(dropped),
                exact_citations=sum(1 for item in annotations if item.get("exact")),
                unsupported=_is_unsupported_answer(answer),
                metadata={
                    # Multi-part completeness, judged the way the runtime does.
                    **_parts_report(prompts[-1], answer),
                    "provider": self.ai_provider,
                    "expected_outcome": case.expectations.expected_outcome,
                    "verifier_issues": list(
                        (response.citation_details or {}).get("citation_guard", {}).get("issues", [])
                    ),
                    "agent_trace": {
                        "model_calls": model_calls,
                        "tool_calls": tool_calls,
                        "citation_count": len(annotations),
                        "tools": list(response.tools_called or []),
                    },
                },
            )
        except Exception as exc:
            if "previous_loader" in locals():
                citation_pipeline.set_source_loader(previous_loader)
            return AgentEvalObservation(
                case_id=case.case_id,
                runner="agent",
                attempt=attempt,
                answer=f"ContractSense agent runner failed: {exc}",
                outcome="OUTCOME_ERR_INTERNAL",
                error=str(exc),
                latency_ms=int((time.time() - started) * 1000),
                turns=len(prompts),
                metadata={"expected_outcome": case.expectations.expected_outcome},
            )

    def _context(self, case: ContractSenseEvalCase, AgentContext, AgentSurface):
        document_ids = [document.document_id for document in case.documents]
        displayed_id = case.target.displayed_document_id or (document_ids[0] if document_ids else None)
        displayed = next(
            (document for document in case.documents if document.document_id == displayed_id),
            case.documents[0] if case.documents else None,
        )
        surface = AgentSurface.PROJECT if len(document_ids) > 1 else AgentSurface.CONTRACT
        return AgentContext(
            surface=surface,
            project_id=case.target.project_id or f"contractsense-eval-{case.case_id}",
            contract_id=case.target.contract_id or displayed_id,
            session_id=f"eval-session-{case.case_id}",
            selected_document_ids=document_ids,
            reference_contract_ids=document_ids,
            displayed_document=(
                {"document_id": displayed.document_id, "filename": displayed.filename}
                if displayed
                else None
            ),
            attached_documents=[
                {"document_id": document.document_id, "filename": document.filename}
                for document in case.documents
            ],
            visible_state={"contract_name": displayed.filename} if displayed else {},
        )

    def _memory_context(
        self,
        case: ContractSenseEvalCase,
        transcript: Sequence[Tuple[str, str]],
    ) -> str:
        """Compose prior turns through the production MemoryComposer.

        Not a re-implementation of the format. The composer is what builds
        `state.memory_context` in every route, so running the eval's turns
        through it means the multi-turn metric measures the text a real
        follow-up actually receives — preamble, heading, provenance label and
        all. The earlier version hand-copied the format and asked, in a
        comment, that someone keep the copies in step; they did not stay in
        step past the first change to it.

        No managers are passed: the harness has no Mongo, and conversation
        turns are the one tier it can supply.
        """
        if not transcript:
            return ""
        recent = list(transcript)[-RECENT_TURN_LIMIT:]
        lines = [
            f"- {'User' if role == 'user' else 'Assistant'}: {normalize(content)[:360]}"
            for role, content in recent
        ]
        composed = MemoryComposer().compose(
            MemoryScope(user_id="eval", question=case.prompt),
            extra_blocks=[recent_turns_block(lines)],
        )
        return composed.text

    def _refs_from_annotations(
        self,
        case: ContractSenseEvalCase,
        annotations: Sequence[Dict[str, Any]],
    ) -> List[str]:
        """Map emitted citations back to fixture section refs.

        The fixture retriever stamps `evidence_id` as `<document_id>::<ref>`, so
        a citation that survived the pipeline carries its own section ref. Quote
        matching is the fallback for citations the model wrote by hand.
        """
        refs: List[str] = []
        for annotation in annotations:
            evidence_id = str(
                annotation.get("evidence_id") or annotation.get("segment_id") or ""
            )
            if "::" in evidence_id:
                ref = evidence_id.split("::", 1)[1]
                if ref and ref not in refs:
                    refs.append(ref)
                    continue
            quote = normalize(str(annotation.get("quote") or ""))
            doc_id = str(annotation.get("doc_id") or annotation.get("document_id") or "")
            if not quote:
                continue
            for document in case.documents:
                if doc_id and document.document_id != doc_id:
                    continue
                for section in document.sections:
                    section_text = normalize(section.text)
                    if not section_text:
                        continue
                    if quote in section_text or section_text in quote:
                        if section.ref not in refs:
                            refs.append(section.ref)
                        break
        return refs

    def _infer_outcome(self, case: ContractSenseEvalCase, answer: str) -> str:
        normalized = normalize(answer)
        if case.expectations.expected_outcome == "OUTCOME_DENIED_SECURITY":
            refusal_terms = (
                "cannot", "can't", "must not", "not disclose", "confidential",
                "authorization", "third party", "refuse", "deny",
            )
            return (
                "OUTCOME_DENIED_SECURITY"
                if any(term in normalized for term in refusal_terms)
                else "OUTCOME_OK"
            )
        if _is_unsupported_answer(answer):
            return "OUTCOME_NONE_UNSUPPORTED"
        return "OUTCOME_OK"


def _is_unsupported_answer(answer: str) -> bool:
    """Did the agent decline for lack of evidence?

    Kept aligned with react_runtime._is_unsupported_or_refusal — that function
    decides whether the runtime demands a citation, and this metric should count
    the same answers it exempts.
    """
    normalized = normalize(answer)
    return any(
        phrase in normalized
        for phrase in (
            "could not find",
            "does not address",
            "not addressed",
            "no indexed",
            "does not contain",
            "did not find",
            "no evidence",
            "insufficient evidence",
            "cannot answer",
            "can't answer",
            "could not produce a final answer",
        )
    )
