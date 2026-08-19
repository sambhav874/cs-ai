"""LangChain tool wrappers for the ContractSense ReAct agent."""

from __future__ import annotations

import ast
import json
from typing import Any, Callable, Dict, List, Literal, Optional

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

from ..state import AgentRunState, ToolCallRecord
from . import errors
from .registry import APPROVAL_REQUIRED_TOOLS


APPROVAL_REQUIRED_FLAG = "__APPROVAL_REQUIRED__"

ToolExecutor = Callable[[ToolCallRecord, AgentRunState], Dict[str, Any]]

#: One automatic retry, and only for kinds errors.RETRYABLE_KINDS allows. More
#: than one turns a slow provider into a stalled run.
TRANSIENT_RETRY_ATTEMPTS = 1


def _invoke_with_transient_retry(
    executor: Optional[ToolExecutor],
    record: ToolCallRecord,
    state: AgentRunState,
    name: str,
) -> Any:
    """Run the executor, retrying once on a genuine infrastructure failure.

    Retrying here rather than sending the error to the model means a timeout
    costs one extra call instead of a whole model turn, and the model never sees
    a failure that fixed itself.
    """
    attempt = 0
    while True:
        try:
            if executor is None:
                return _default_read_observation(record, state)
            return executor(record, state)
        except Exception as exc:
            kind = errors.classify(exc)
            if attempt >= TRANSIENT_RETRY_ATTEMPTS or not errors.is_retryable(kind):
                raise
            attempt += 1
            state.add_trace(
                "tool_retry",
                iteration=record.iteration,
                tool=name,
                kind=kind.value,
                attempt=attempt,
                detail=str(exc)[:300],
            )


class ListDocumentsInput(BaseModel):
    document_ids: Any = Field(default_factory=list, description="Optional scoped document IDs to return; leave blank to list every authorized document.")


class DocumentReadInput(BaseModel):
    document_id: str = Field(default="", description="Unique ID of the target document. Leave blank for the current scoped document.")
    mode: Literal["outline", "excerpt", "full"] = Field(default="excerpt", description="Use outline for headings, excerpt for a focused read, or full for coverage-sensitive review.")
    max_chars: int = Field(default=50000, ge=1000, le=100000, description="Maximum indexed characters to return in full mode.")


class SearchInput(BaseModel):
    query: Any = Field(default="", description="Concise clause/evidence query rewritten from the user's need, e.g. 'governing law', 'change of control', or 'payment deadline'.")
    exact: str = Field(default="", description="Optional exact phrase or clause reference to locate within the authorized documents.")
    queries: Any = Field(default_factory=list, description="Optional related query variants when the issue has aliases or multiple evidence needs.")
    document_ids: Any = Field(default_factory=list, description="Optional document IDs to restrict search; leave blank to search the authorized scope.")
    top_k: Any = Field(default=12, description="Maximum evidence snippets to return. Default is 12. Use 12-20 for query clause banks or dense documents.")
    intent: str = Field(default="", description="Optional retrieval intent: fact, summary, compare, or normal.")
    must_contain: Any = Field(default_factory=list, description="Optional exact terms that evidence must contain; use sparingly when the user requires a phrase.")
    section_ref: str = Field(default="", description="Optional section, clause, article, schedule, or exhibit reference from the user's request.")


class ProjectMemoryInput(BaseModel):
    view: Literal["index", "document", "events"] = Field(default="index", description="Use index for the project map, document for one document overview, or events for recent project activity.")
    document_id: str = Field(default="", description="Required only when view=document; use an ID returned by the project index.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum events to return when view=events.")


class RememberFactInput(BaseModel):
    text: str = Field(default="", description="The fact to remember, stated plainly and self-contained.")
    contract_id: str = Field(default="", description="Document id the fact was taken from. Required unless the user simply told you the fact.")
    quote: str = Field(default="", description="The exact wording from that document supporting the fact, so it can be re-verified later.")
    tags: str = Field(default="", description="Optional comma-separated topic tags.")
    origin: str = Field(default="contract", description="'contract' when taken from a document, 'user' when the user stated it.")


class CorrectFactInput(BaseModel):
    fact_id: str = Field(default="", description="Fact ID to correct, exactly as shown by project memory.")
    fact_description: str = Field(default="", description="Optional description or search snippet of the fact to correct if fact_id is not known.")
    corrected_value: str = Field(default="", description="The corrected fact value or replacement text.")
    text: str = Field(default="", description="The corrected fact, stated plainly and self-contained (alias for corrected_value).")
    reason: str = Field(default="", description="Reason for the correction or supporting context.")
    quote: str = Field(default="", description="Optional exact wording from the source document supporting the correction (alias for reason).")
    tags: str = Field(default="", description="Optional comma-separated topic tags.")
    origin: str = Field(default="user", description="'user' when the lawyer supplied the correction; use 'contract' only with a supporting document quote.")


class KPIInput(BaseModel):
    contract_id: str = Field(default="", description="Contract ID owning KPI/SLA records. Leave blank for current contract or document.")
    metric_name: str = Field(default="", description="Optional KPI/SLA metric name to filter by.")
    query: str = Field(default="", description="User's natural language query to find relevant KPIs.")


class KPIExtractionInput(BaseModel):
    contract_id: str = Field(default="", description="Single ingested contract ID to extract KPI/SLA candidates for.")
    replace_drafts: bool = Field(default=True, description="Replace existing draft/ignored KPI candidates for this contract.")
    ai_provider: str = Field(default="", description="Optional AI provider to use for hybrid KPI extraction.")


class CalculateInput(BaseModel):
    expression: str = Field(default="", description="Arithmetic expression using only values observed in evidence or KPI context.")
    context: str = Field(default="", description="Calculation context and cited source values that justify the expression.")


class CreateTabularReviewInput(BaseModel):
    name: str = Field(default="ContractSense Review", description="Review title.")
    document_ids: Any = Field(default_factory=list, description="Documents to review.")
    columns: Any = Field(default_factory=list, description="Proposed review columns.")


class GenerateTabularReviewInput(BaseModel):
    review_id: str = Field(default="", description="Existing tabular review ID.")
    instructions: str = Field(default="", description="Generation instructions.")


class ReplicateDocumentInput(BaseModel):
    document_id: str = Field(default="", description="Document to replicate.")
    target_project_id: str = Field(default="", description="Destination project ID.")


def build_langchain_tools(
    *,
    state: AgentRunState,
    tool_executor: Optional[ToolExecutor] = None,
    fallback_executor: Optional[ToolExecutor] = None,
) -> List[BaseTool]:
    """Build state-bound LangChain tools for one agent run."""

    def run_read_tool(
        name: str,
        args: Dict[str, Any],
        *,
        executor_name: Optional[str] = None,
        executor_args: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        record = ToolCallRecord(
            name=name,
            args=_sanitize_args(args),
            status="planned",
            reason="Selected by LangChain ReAct executor.",
            iteration=len(state.tools) + 1,
        )
        state.tools.append(record)
        state.add_trace("tool_start", iteration=record.iteration, tool=record.name, args=record.args)
        executor = tool_executor or fallback_executor

        exhausted_reason = errors.budget_exceeded(state)
        if exhausted_reason:
            result = errors.envelope(
                errors.ToolErrorKind.BUDGET_EXHAUSTED, tool=name, detail=exhausted_reason
            )
            # Hand back what was already retrieved, so the model can still write a
            # cited answer instead of being cut off empty-handed.
            result["matches"] = _recent_observed_matches(state)
            record.status = "error"
            state.add_trace("tool_budget_exhausted", tool=record.name, reason=exhausted_reason)
        else:
            try:
                # The public surface is intentionally narrower than the
                # executor's stable implementation names. Keep the public
                # record for traces and policy while reusing the proven handler.
                execution_updates: Dict[str, Any] = {}
                if executor_name and executor_name != name:
                    execution_updates["name"] = executor_name
                if executor_args is not None:
                    execution_updates["args"] = _sanitize_args(executor_args)
                execution_record = record.model_copy(update=execution_updates) if execution_updates else record
                result = _coerce_observation(
                    _invoke_with_transient_retry(executor, execution_record, state, name)
                )
                summary_text = str(result.get("summary") or "")
                if len(summary_text) > 4000:
                    result["summary"] = summary_text[:4000] + "\n... [truncated due to context budget limits]"
                    state.add_trace("middleware:ContextEditingMiddleware", mode="prune_large_tool_results", original_len=len(summary_text))
                record.status = "done"
            except Exception as exc:
                # Typed envelope rather than a raw string, so the model can tell an
                # out-of-scope denial from a no-match from a provider blip and act
                # accordingly instead of retrying whatever it was.
                kind = errors.classify(exc)
                result = errors.envelope(
                    kind,
                    tool=name,
                    detail=str(exc),
                    retried=errors.is_retryable(kind),
                )
                record.status = "error"
                record.reason = result["error"]["recovery_hint"]
                state.add_trace(
                    "tool_error",
                    iteration=record.iteration,
                    tool=record.name,
                    kind=kind.value,
                    retryable=result["error"]["retryable"],
                    detail=str(exc)[:300],
                )
        record.observation = result
        state.react_scratchpad.append({
            "iteration": record.iteration,
            "tool": record.name,
            "status": record.status,
            "observation": result,
        })
        state.add_trace(
            "tool_result",
            iteration=record.iteration,
            tool=record.name,
            status=record.status,
            summary=str(result.get("summary") or "")[:500],
        )
        state.add_trace(
            "react_tool_observation",
            iteration=record.iteration,
            tool=record.name,
            status=record.status,
            summary=str(result.get("summary") or "")[:500],
        )
        return result

    def run_approval_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        params = _sanitize_args(args)
        record = ToolCallRecord(
            name=name,
            args=params,
            status="planned",
            reason="Side-effecting tool blocked until human approval.",
            iteration=len(state.tools) + 1,
        )
        payload = _approval_payload(name=name, params=params, state=state)
        record.observation = payload
        state.tools.append(record)
        state.add_trace("tool_start", iteration=record.iteration, tool=record.name, args=record.args)
        state.react_scratchpad.append({
            "iteration": record.iteration,
            "tool": record.name,
            "status": record.status,
            "observation": payload,
        })
        state.add_trace(
            "tool_result",
            iteration=record.iteration,
            tool=record.name,
            status=record.status,
            summary=payload["message"],
        )
        state.add_trace("approval_required", tool=record.name, reason_summary=payload["message"])
        state.add_trace(
            "react_tool_observation",
            iteration=record.iteration,
            tool=record.name,
            status=record.status,
            summary=payload["message"],
        )
        # Returning the proposal keeps LangChain's tool batch intact: a sibling
        # read in the same model response must finish so its evidence is not
        # discarded merely because another call needs approval.
        return payload

    @tool("list_documents", args_schema=ListDocumentsInput)
    def list_documents(document_ids: Any = None) -> Dict[str, Any]:
        """List metadata for every scoped document, or fetch a named subset by ID. READ-ONLY."""
        payload = _payload_from_react_value(document_ids, "document_ids")
        return run_read_tool("list_documents", {"document_ids": _coerce_list(payload.get("document_ids"))})

    @tool("read_document", args_schema=DocumentReadInput)
    def read_document(document_id: str = "", mode: str = "excerpt", max_chars: int = 50000) -> Dict[str, Any]:
        """Read a scoped document in outline, excerpt, or full mode. Use full when coverage matters; use search_evidence for a specific clause. READ-ONLY."""
        payload = _payload_from_react_value(document_id, "document_id")
        selected_mode = str(mode or "excerpt").strip().lower()
        executor_name = "outline_document" if selected_mode == "outline" else "read_document"
        return run_read_tool(
            "read_document",
            {
                "document_id": payload.get("document_id", ""),
                "mode": selected_mode,
                "max_chars": max_chars,
            },
            executor_name=executor_name,
            executor_args={
                "document_id": payload.get("document_id", ""),
                "include_full": selected_mode == "full",
                "max_chars": max_chars,
            },
        )

    @tool("search_evidence", args_schema=SearchInput)
    def search_evidence(
        query: Any = "",
        exact: str = "",
        queries: Any = None,
        document_ids: Any = None,
        top_k: Any = 12,
        intent: str = "",
        must_contain: Any = None,
        section_ref: str = "",
    ) -> Dict[str, Any]:
        """Search scoped contracts for clause-level evidence; use exact= to locate an exact phrase or clause reference. READ-ONLY."""
        payload = _payload_from_react_value(query, "query")
        if exact:
            payload["exact"] = exact
        if queries not in (None, "", [], {}):
            payload["queries"] = queries
        if document_ids not in (None, "", [], {}):
            payload["document_ids"] = document_ids
        if top_k not in (None, "", [], {}):
            payload["top_k"] = top_k
        if intent:
            payload["intent"] = intent
        if must_contain not in (None, "", [], {}):
            payload["must_contain"] = must_contain
        if section_ref:
            payload["section_ref"] = section_ref
        rewritten_queries = _coerce_list(payload.get("queries"))
        exact_query = str(payload.get("exact") or "")
        primary_query = exact_query or str(payload.get("query") or "")
        if primary_query and primary_query not in rewritten_queries:
            rewritten_queries.insert(0, primary_query)
        required_terms = _coerce_list(payload.get("must_contain"))
        if exact_query and exact_query not in required_terms:
            required_terms.append(exact_query)
        return run_read_tool(
            "search_evidence",
            {
                "query": str(payload.get("query") or ""),
                "exact": exact_query,
                "queries": _coerce_list(payload.get("queries")),
                "document_ids": _coerce_list(payload.get("document_ids")),
                "top_k": _coerce_int(payload.get("top_k"), 12),
                "intent": str(payload.get("intent") or ""),
                "must_contain": _coerce_list(payload.get("must_contain")),
                "section_ref": str(payload.get("section_ref") or ""),
            },
            executor_args={
                "query": primary_query,
                "queries": rewritten_queries,
                "document_ids": _coerce_list(payload.get("document_ids")),
                "top_k": _coerce_int(payload.get("top_k"), 12),
                "intent": str(payload.get("intent") or ""),
                "must_contain": required_terms,
                "section_ref": str(payload.get("section_ref") or ""),
            },
        )

    @tool("project_memory", args_schema=ProjectMemoryInput)
    def project_memory(view: str = "index", document_id: str = "", limit: int = 20) -> Dict[str, Any]:
        """Read the project index, one document overview, or recent events. Project memory is context, not clause evidence. READ-ONLY."""
        selected_view = str(view or "index").strip().lower()
        if selected_view == "document":
            return run_read_tool(
                "project_memory",
                {"view": selected_view, "document_id": document_id},
                executor_name="read_project_concept",
                executor_args={"document_id": document_id},
            )
        if selected_view == "events":
            return run_read_tool(
                "project_memory",
                {"view": selected_view, "limit": limit},
                executor_name="read_project_events",
                executor_args={"limit": limit},
            )
        # Always use the route-built project scope, never a model-supplied ID.
        return run_read_tool(
            "project_memory",
            {"view": selected_view},
            executor_name="get_project_timeline",
            executor_args={"project_id": state.context.project_id or ""},
        )

    @tool("remember_fact", args_schema=RememberFactInput)
    def remember_fact(
        text: str = "",
        contract_id: str = "",
        quote: str = "",
        tags: str = "",
        origin: str = "contract",
    ) -> Dict[str, Any]:
        """Record a durable fact about this project. Propose this whenever the user volunteers a fact worth keeping, even without them saying "remember" — never to log routine conversation. A fact taken from a document must include its document id and the exact supporting quote. Requires human approval before writing."""
        return run_approval_tool("remember_fact", {
            "text": text,
            "contract_id": contract_id,
            "quote": quote,
            "tags": tags,
            "origin": origin,
        })

    @tool("correct_fact", args_schema=CorrectFactInput)
    def correct_fact(
        fact_id: str = "",
        fact_description: str = "",
        corrected_value: str = "",
        text: str = "",
        reason: str = "",
        quote: str = "",
        tags: str = "",
        origin: str = "user",
    ) -> Dict[str, Any]:
        """Correct a durable project fact supplied by the user. The existing fact is preserved for audit, the replacement is recorded, and the old fact is superseded only after human approval."""
        resolved_text = corrected_value or text
        resolved_reason = reason or quote
        return run_approval_tool("correct_fact", {
            "fact_id": fact_id,
            "fact_description": fact_description,
            "corrected_value": resolved_text,
            "text": resolved_text,
            "reason": resolved_reason,
            "quote": resolved_reason,
            "tags": tags,
            "origin": origin,
        })

    @tool("get_kpi_context", args_schema=KPIInput)
    def get_kpi_context(contract_id: str = "", metric_name: str = "", query: str = "") -> Dict[str, Any]:
        """Retrieve KPI/SLA targets, actuals, breach state, and operational context relevant to the user query. READ-ONLY."""
        payload = _payload_from_react_value(contract_id, "contract_id")
        if metric_name:
            payload["metric_name"] = metric_name
        if query:
            payload["query"] = query
        return run_read_tool("get_kpi_context", {"contract_id": payload.get("contract_id", ""), "metric_name": payload.get("metric_name", ""), "query": payload.get("query", "")})

    @tool("extract_kpis", args_schema=KPIExtractionInput)
    def extract_kpis(contract_id: str = "", replace_drafts: bool = True, ai_provider: str = "") -> Dict[str, Any]:
        """Run KPI/SLA extraction for one scoped ingested contract. Requires human approval before writing draft KPI records."""
        payload = _payload_from_react_value(contract_id, "contract_id")
        payload["replace_drafts"] = replace_drafts
        if ai_provider:
            payload["ai_provider"] = ai_provider
        return run_approval_tool("extract_kpis", payload)

    @tool("calculate_from_evidence", args_schema=CalculateInput)
    def calculate_from_evidence(expression: str = "", context: str = "") -> Dict[str, Any]:
        """Calculate values only from cited evidence/KPI context and return the evaluated expression. READ-ONLY."""
        payload = _payload_from_react_value(expression, "expression")
        if context:
            payload["context"] = context
        return run_read_tool("calculate_from_evidence", {"expression": payload.get("expression", ""), "context": payload.get("context", "")})

    @tool("propose_tabular_review", args_schema=CreateTabularReviewInput)
    def propose_tabular_review(name: str = "ContractSense Review", document_ids: Any = None, columns: Any = None) -> Dict[str, Any]:
        """Propose an editable structured tabular review. Requires human approval before creation."""
        payload = _payload_from_react_value(name, "name")
        if document_ids:
            payload["document_ids"] = document_ids
        if columns:
            payload["columns"] = columns
        return run_approval_tool("propose_tabular_review", {"name": payload.get("name", "ContractSense Review"), "document_ids": _coerce_list(payload.get("document_ids")), "columns": _coerce_list(payload.get("columns"))})

    @tool("generate_tabular_review", args_schema=GenerateTabularReviewInput)
    def generate_tabular_review(review_id: str = "", instructions: str = "") -> Dict[str, Any]:
        """Propose generating tabular review cells. Requires human approval."""
        payload = _payload_from_react_value(review_id, "review_id")
        if instructions:
            payload["instructions"] = instructions
        return run_approval_tool("generate_tabular_review", payload)

    @tool("replicate_document", args_schema=ReplicateDocumentInput)
    def replicate_document(document_id: str = "", target_project_id: str = "") -> Dict[str, Any]:
        """Propose replicating a document into another project. Requires human approval."""
        payload = _payload_from_react_value(document_id, "document_id")
        if target_project_id:
            payload["target_project_id"] = target_project_id
        return run_approval_tool("replicate_document", payload)

    return [
        list_documents,
        read_document,
        search_evidence,
        project_memory,
        remember_fact,
        correct_fact,
        get_kpi_context,
        extract_kpis,
        calculate_from_evidence,
        propose_tabular_review,
        generate_tabular_review,
        replicate_document,
    ]


def is_approval_required_payload(value: Any) -> bool:
    payload = parse_tool_output(value)
    return (
        isinstance(payload, dict)
        and (
            bool(payload.get(APPROVAL_REQUIRED_FLAG))
            or payload.get("status") == "approval_required"
        )
    )


def parse_tool_output(value: Any) -> Any:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        try:
            return ast.literal_eval(text)
        except (SyntaxError, ValueError):
            return value


def _approval_payload(name: str, params: Dict[str, Any], state: AgentRunState) -> Dict[str, Any]:
    context = state.context
    payload_params = {
        **params,
        "question": state.message,
        "contract_id": context.contract_id,
        "project_id": context.project_id,
        "session_id": context.session_id,
        "scope_id": context.contract_id or context.project_id or context.session_id,
    }
    return {
        APPROVAL_REQUIRED_FLAG: True,
        "status": "approval_required",
        "tool": name,
        "params": payload_params,
        "message": (
            f"Action '{name}' requires human approval before execution. "
            "Review the parameters and confirm before any side effect occurs."
        ),
    }


def _sanitize_args(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: value
        for key, value in dict(args or {}).items()
        if value not in (None, "", [], {})
    }


def _payload_from_react_value(value: Any, field_name: str) -> Dict[str, Any]:
    parsed = parse_tool_output(value)
    if isinstance(parsed, dict):
        return dict(parsed)
    if parsed in (None, "", [], {}):
        return {}
    return {field_name: parsed}


def _coerce_list(value: Any) -> List[str]:
    parsed = parse_tool_output(value)
    if parsed in (None, "", {}, []):
        return []
    if isinstance(parsed, dict):
        for key in ("document_ids", "evidence_ids", "columns", "keys"):
            if key in parsed:
                return _coerce_list(parsed[key])
        return []
    if isinstance(parsed, list):
        return [str(item) for item in parsed if str(item).strip()]
    return [str(parsed)] if str(parsed).strip() else []


def _coerce_int(value: Any, default: int) -> int:
    parsed = parse_tool_output(value)
    try:
        return int(parsed)
    except (TypeError, ValueError):
        return default


def _coerce_observation(result: Any) -> Dict[str, Any]:
    if isinstance(result, dict):
        return result
    return {"summary": str(result)[:1000]}


def _default_read_observation(tool_record: ToolCallRecord, state: AgentRunState) -> Dict[str, Any]:
    selected_ids = state.context.selected_document_ids or state.context.reference_contract_ids
    if tool_record.name in {"list_documents", "fetch_documents"}:
        return {
            "summary": f"{len(selected_ids)} scoped document(s) available.",
            "document_ids": selected_ids[:10],
        }
    if tool_record.name in {"read_document", "outline_document"}:
        displayed = state.context.displayed_document or {}
        return {
            "summary": "Current document context is available.",
            "document_id": displayed.get("document_id") or state.context.contract_id or (selected_ids[0] if selected_ids else None),
            "filename": displayed.get("filename"),
        }
    if tool_record.name in {"search_evidence", "find_in_document"}:
        return {"summary": "Evidence retrieval is delegated to the scoped ContractSense RAG executor."}
    if tool_record.name == "get_kpi_context":
        return {"summary": "KPI context requested.", "visible_state": state.context.visible_state}
    if tool_record.name in APPROVAL_REQUIRED_TOOLS:
        return {"summary": "Approval-required tool proposal captured.", "risk": "approval_required"}
    return {"summary": f"Read-only tool {tool_record.name} completed."}


def _recent_observed_matches(state: AgentRunState) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for scratch in reversed(state.react_scratchpad):
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        candidates: List[Dict[str, Any]] = []
        if isinstance(observation.get("matches"), list):
            candidates.extend(item for item in observation["matches"] if isinstance(item, dict))
        if observation.get("snippet"):
            candidates.append(observation)
        for candidate in candidates:
            quote = str(candidate.get("quote") or candidate.get("snippet") or candidate.get("context") or "").strip()
            if not quote:
                continue
            doc_id = str(candidate.get("document_id") or candidate.get("doc_id") or candidate.get("filename") or "")
            key = (doc_id, quote[:160])
            if key in seen:
                continue
            seen.add(key)
            matches.append(candidate)
            if len(matches) >= 8:
                return list(reversed(matches))
    return list(reversed(matches))
