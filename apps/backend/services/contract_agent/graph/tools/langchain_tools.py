"""LangChain tool wrappers for the ContractSense ReAct agent."""

from __future__ import annotations

import ast
import json
from typing import Any, Callable, Dict, List, Optional

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

from ..state import AgentRunState, ToolCallRecord
from .registry import APPROVAL_REQUIRED_TOOLS


APPROVAL_REQUIRED_FLAG = "__APPROVAL_REQUIRED__"

ToolExecutor = Callable[[ToolCallRecord, AgentRunState], Dict[str, Any]]

READ_TOOL_REPEAT_LIMITS = {
    "search_evidence": 5,
    "find_in_document": 4,
    "read_document": 3,
    "outline_document": 2,
    "get_kpi_context": 2,
}


class ProjectInput(BaseModel):
    project_id: str = Field(default="", description="Optional project scope ID. Leave blank to use the current authorized scope.")


class DocumentIdInput(BaseModel):
    document_id: str = Field(default="", description="Unique ID of the target document. Leave blank for the current scoped document.")


class FetchDocumentsInput(BaseModel):
    document_ids: Any = Field(default_factory=list, description="Optional document IDs to fetch; leave blank to inspect scoped documents.")


class SearchInput(BaseModel):
    query: Any = Field(..., description="Concise clause/evidence query rewritten from the user's need, e.g. 'governing law', 'change of control', or 'payment deadline'.")
    queries: Any = Field(default_factory=list, description="Optional related query variants when the issue has aliases or multiple evidence needs.")
    document_ids: Any = Field(default_factory=list, description="Optional document IDs to restrict search; leave blank to search the authorized scope.")
    top_k: Any = Field(default=12, description="Maximum evidence snippets to return. Default is 12. Use 12-20 for query clause banks or dense documents.")
    intent: str = Field(default="", description="Optional retrieval intent: fact, summary, compare, or normal.")
    must_contain: Any = Field(default_factory=list, description="Optional exact terms that evidence must contain; use sparingly when the user requires a phrase.")
    section_ref: str = Field(default="", description="Optional section, clause, article, schedule, or exhibit reference from the user's request.")


class FindInDocumentInput(BaseModel):
    document_id: str = Field(default="", description="Document to search within; leave blank for the current scoped document.")
    term: str = Field(default="", description="Exact keyword, phrase, or clause reference to locate after broad evidence search is too thin.")
    query: str = Field(default="", description="Alias for term.")


class KPIInput(BaseModel):
    contract_id: str = Field(default="", description="Contract ID owning KPI/SLA records.")
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

    def run_read_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        from services.contract_agent.graph.middleware import UnauthorizedAccessError
        doc_id = args.get("document_id") or args.get("contract_id")
        if doc_id and state.context.selected_document_ids:
            if doc_id not in state.context.selected_document_ids:
                raise UnauthorizedAccessError(f"Access to document {doc_id} is out of scoped context!")
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
        try:
            loop_result = _read_tool_loop_result(name, state)
            result = loop_result if loop_result else executor(record, state) if executor else _default_read_observation(record, state)
            result = _coerce_observation(result)
            summary_text = str(result.get("summary") or "")
            if len(summary_text) > 4000:
                result["summary"] = summary_text[:4000] + "\n... [truncated due to context budget limits]"
                state.add_trace("middleware:ContextEditingMiddleware", mode="prune_large_tool_results", original_len=len(summary_text))
            record.status = "done"
            if result.get("tool_budget_exhausted"):
                state.add_trace("tool_budget_exhausted", tool=record.name, summary=str(result.get("summary") or "")[:500])
        except Exception as exc:
            result = {"summary": "Tool execution failed.", "error": str(exc)[:500]}
            record.status = "error"
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
        from services.contract_agent.graph.middleware import UnauthorizedAccessError
        doc_id = args.get("document_id") or args.get("contract_id")
        if doc_id and state.context.selected_document_ids:
            if doc_id not in state.context.selected_document_ids:
                raise UnauthorizedAccessError(f"Access to document {doc_id} is out of scoped context!")
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
        from services.contract_agent.react_agent import ApprovalRequiredError
        raise ApprovalRequiredError(payload)

    @tool("list_documents", args_schema=ProjectInput)
    def list_documents(project_id: str = "") -> Dict[str, Any]:
        """List scoped documents with IDs, filenames, and indexing metadata. READ-ONLY."""
        return run_read_tool("list_documents", {"project_id": project_id})

    @tool("fetch_documents", args_schema=FetchDocumentsInput)
    def fetch_documents(document_ids: Any = None) -> Dict[str, Any]:
        """Fetch metadata for scoped indexed documents. READ-ONLY."""
        payload = _payload_from_react_value(document_ids, "document_ids")
        return run_read_tool("fetch_documents", {"document_ids": _coerce_list(payload.get("document_ids"))})

    @tool("read_document", args_schema=DocumentIdInput)
    def read_document(document_id: str = "") -> Dict[str, Any]:
        """Read the current or requested scoped document excerpt. READ-ONLY."""
        payload = _payload_from_react_value(document_id, "document_id")
        return run_read_tool("read_document", {"document_id": payload.get("document_id", "")})

    @tool("outline_document", args_schema=DocumentIdInput)
    def outline_document(document_id: str = "") -> Dict[str, Any]:
        """Return the current or requested document outline when available. READ-ONLY."""
        payload = _payload_from_react_value(document_id, "document_id")
        return run_read_tool("outline_document", {"document_id": payload.get("document_id", "")})

    @tool("search_evidence", args_schema=SearchInput)
    def search_evidence(
        query: Any,
        queries: Any = None,
        document_ids: Any = None,
        top_k: Any = 12,
        intent: str = "",
        must_contain: Any = None,
        section_ref: str = "",
    ) -> Dict[str, Any]:
        """Search scoped contracts for clause-level evidence with quote, context, page, section, score, and evidence ID. READ-ONLY."""
        payload = _payload_from_react_value(query, "query")
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
        primary_query = str(payload.get("query") or "")
        if primary_query and primary_query not in rewritten_queries:
            rewritten_queries.insert(0, primary_query)
        return run_read_tool(
            "search_evidence",
            {
                "query": primary_query,
                "queries": rewritten_queries,
                "document_ids": _coerce_list(payload.get("document_ids")),
                "top_k": _coerce_int(payload.get("top_k"), 12),
                "intent": str(payload.get("intent") or ""),
                "must_contain": _coerce_list(payload.get("must_contain")),
                "section_ref": str(payload.get("section_ref") or ""),
            },
        )

    @tool("find_in_document", args_schema=FindInDocumentInput)
    def find_in_document(document_id: str = "", term: str = "", query: str = "") -> Dict[str, Any]:
        """Find an exact term, phrase, or formal clause reference inside one scoped document. READ-ONLY."""
        payload = _payload_from_react_value(document_id, "document_id")
        if term:
            payload["term"] = term
        if query:
            payload["query"] = query
        return run_read_tool("find_in_document", {"document_id": payload.get("document_id", ""), "term": payload.get("term", ""), "query": payload.get("query") or payload.get("term", "")})

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

    @tool("create_tabular_review", args_schema=CreateTabularReviewInput)
    def create_tabular_review(name: str = "ContractSense Review", document_ids: Any = None, columns: Any = None) -> Dict[str, Any]:
        """Propose a structured tabular review. Requires human approval."""
        payload = _payload_from_react_value(name, "name")
        if document_ids:
            payload["document_ids"] = document_ids
        if columns:
            payload["columns"] = columns
        return run_approval_tool("create_tabular_review", {"name": payload.get("name", "ContractSense Review"), "document_ids": _coerce_list(payload.get("document_ids")), "columns": _coerce_list(payload.get("columns"))})

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

    @tool("suggest_tabular_review", args_schema=CreateTabularReviewInput)
    def suggest_tabular_review(name: str = "ContractSense Review", document_ids: Any = None, columns: Any = None) -> Dict[str, Any]:
        """Propose an editable tabular review configuration. Requires human approval."""
        payload = _payload_from_react_value(name, "name")
        if document_ids:
            payload["document_ids"] = document_ids
        if columns:
            payload["columns"] = columns
        return run_approval_tool("suggest_tabular_review", {"name": payload.get("name", "ContractSense Review"), "document_ids": _coerce_list(payload.get("document_ids")), "columns": _coerce_list(payload.get("columns"))})

    return [
        list_documents,
        fetch_documents,
        read_document,
        outline_document,
        search_evidence,
        find_in_document,
        get_kpi_context,
        extract_kpis,
        calculate_from_evidence,
        create_tabular_review,
        generate_tabular_review,
        replicate_document,
        suggest_tabular_review,
    ]


def is_approval_required_payload(value: Any) -> bool:
    payload = parse_tool_output(value)
    return isinstance(payload, dict) and bool(payload.get(APPROVAL_REQUIRED_FLAG))


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


def _read_tool_loop_result(name: str, state: AgentRunState) -> Dict[str, Any] | None:
    limit = READ_TOOL_REPEAT_LIMITS.get(name)
    if not limit:
        return None
    prior_count = sum(1 for tool in state.tools[:-1] if tool.name == name)
    if prior_count < limit:
        return None
    return {
        "summary": (
            f"{name} has already run in this turn. "
            "Use any observed evidence to produce the final answer now. "
            "If the answer is not supported by the observed evidence, say the scoped evidence does not contain it."
        ),
        "tool_budget_exhausted": True,
        "matches": _recent_observed_matches(state),
    }


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
