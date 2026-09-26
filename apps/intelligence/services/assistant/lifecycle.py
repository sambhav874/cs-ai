"""The platform's lifecycle tools, run inside ContractSense's agent loop.

The tools themselves are draftLegal's (agents_service/tools): thin HTTP calls
into the lifecycle API's /api/internal/ai/tools/*, bound to the caller's org so
a model cannot name another tenant. What this module adds is everything the
old orchestrator did around each call, so moving the tools onto the
ContractSense runtime loses none of it:

  • per-tool caps (contract_get, counterparty_get: 3 a turn) on top of the
    runtime's shared call budget
  • a heartbeat frame every few seconds while a slow tool runs, so the chat
    shows progress rather than a frozen spinner
  • tool output framed as untrusted data before the model reads it, since it
    carries counterparty text; the platform's own errors are not framed
  • write tools never execute: their proposal becomes an Apply card, and the
    model is told the change is waiting for the user
  • the frames the chat renders (tool_call_result with the tool's JSON, the
    awaiting-confirmation card), emitted as the tool finishes

Each wrapped call is recorded on the run state like any evidence tool, so the
shared budget, the trace and answer-from-observations see it.
"""
# TODO(licence): draftLegal's agent tools (agents_service/tools, AGPL-3.0) run inside ContractSense's runtime here.

from __future__ import annotations

import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional

from langchain_core.tools import BaseTool, StructuredTool

from services.contract_agent.graph.state import AgentRunState, ToolCallRecord
from services.contract_agent.graph.tools import errors as tool_errors

logger = logging.getLogger(__name__)

Emit = Callable[[Dict[str, Any]], None]

# A turn that needs more than three of these is enumerating one at a time when
# it should broaden with portfolio_search or contract_search.
PER_TOOL_BUDGET: Dict[str, int] = {"contract_get": 3, "counterparty_get": 3}

# Tools whose chat rendering needs their whole JSON (tables, drafts, redline
# variants, citation bundles, entity titles). Everything else streams a short
# preview; the model always gets the full result.
FULL_PREVIEW_TOOLS = frozenset({
    "redline_propose", "playbook_check", "contract_cite", "contract_search", "contract_filter",
    "portfolio_search", "counterparty_memory", "counterparty_get", "counterparty_list",
    "org_memory", "obligations_list", "renewal_advice", "contract_create_from_template",
    "contract_get", "contract_summarize", "space_list", "approval_list", "portfolio_compare",
    "compliance_get",
})
FULL_PREVIEW_CHARS = 20_000
SHORT_PREVIEW_CHARS = 800

HEARTBEAT_FIRST_SECONDS = 3.0
HEARTBEAT_INTERVAL_SECONDS = 4.0


@dataclass
class LifecycleTurn:
    """What the lifecycle tools did this turn, and how to report it."""

    emit: Emit
    counts: Dict[str, int] = field(default_factory=dict)
    # Set by the frame translator from the runtime's tool_call event, which
    # fires just before the tool runs; the tool reports under the same id.
    current_call_id: Optional[str] = None
    proposals: List[Dict[str, Any]] = field(default_factory=list)
    # Platform contract id → title, from every result that named one: lets
    # the answer say "the Acme MSA" where the model wrote the raw id.
    titles: Dict[str, str] = field(default_factory=dict)


def lifecycle_evidence(name: str, text: str) -> List[Dict[str, Any]]:
    """The contract words a lifecycle tool returned, as citable evidence.

    Only verbatim document text counts: contract_get's plainText, the windows
    clause_search matched, contract_cite's passages, portfolio_search's
    excerpts, contract_summarize's opening snippet. Metadata (dates, values,
    key terms) and the AI-written summary are the database's words, not the
    contract's, so a quote of them is never a citation. Each entry names the
    platform contract it came from, so a citation opens that contract.
    """
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, dict):
        return []
    out: List[Dict[str, Any]] = []

    def add(contract_id: Any, title: Any, passage: Any, **extra: Any) -> None:
        passage = str(passage or "").strip()
        if contract_id and passage:
            out.append({"document_id": str(contract_id), "filename": str(title or "") or None,
                        "context": passage, "platform": True, **extra})

    if name == "contract_get":
        add(data.get("id"), data.get("title"), data.get("plainText"), full_text=True)
    elif name == "contract_summarize":
        add(data.get("id"), data.get("title"), data.get("plainTextSnippet"))
    elif name == "clause_search":
        for m in data.get("matches") or []:
            if isinstance(m, dict):
                add(data.get("contractId"), data.get("title"),
                    f"{m.get('beforeContext') or ''}{m.get('match') or ''}{m.get('afterContext') or ''}")
    elif name == "contract_cite":
        for c in data.get("citations") or []:
            if isinstance(c, dict):
                add(data.get("contractId"), data.get("title"), c.get("quote"),
                    page=c.get("page"), section=c.get("sectionRef"))
    elif name == "portfolio_search":
        for h in data.get("hits") or []:
            if isinstance(h, dict):
                add(h.get("contractId"), h.get("contractTitle"), h.get("excerpt"),
                    page=h.get("page"), section=h.get("sectionRef"))
    return out


def contract_titles(text: str) -> Dict[str, str]:
    """Every (contract id, title) pair a lifecycle result carries."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return {}
    out: Dict[str, str] = {}

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
        elif isinstance(node, dict):
            cid = node.get("id") or node.get("contractId")
            title = node.get("title") or node.get("contractTitle")
            if isinstance(cid, str) and cid.startswith("cm") and isinstance(title, str) and title.strip():
                out.setdefault(cid, title.strip())
            for value in node.values():
                if isinstance(value, (list, dict)):
                    visit(value)

    visit(data)
    return out


def _budget_message(name: str, used: int, cap: int) -> str:
    return (
        f"BUDGET_EXCEEDED: {name} called {used} times this turn (cap = {cap}). Stop invoking {name}; "
        "either broaden via portfolio_search/contract_search, or answer from the results so far."
    )


def _untrusted(name: str, payload: str) -> str:
    from agents_service.untrusted import wrap_untrusted_document

    return wrap_untrusted_document(payload, source=f"tool `{name}` output derived from user/counterparty documents")


def _run_with_heartbeat(fn: Callable[[], Any], *, on_beat: Callable[[float], None]) -> Any:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(fn)
        waited = 0.0
        timeout = HEARTBEAT_FIRST_SECONDS
        while True:
            try:
                return future.result(timeout=timeout)
            except FutureTimeout:
                waited += timeout
                on_beat(round(waited, 1))
                timeout = HEARTBEAT_INTERVAL_SECONDS


def wrap_lifecycle_tool(tool: BaseTool, *, turn: LifecycleTurn, state: AgentRunState) -> StructuredTool:
    name = tool.name

    def _call(**kwargs: Any) -> str:
        call_id = turn.current_call_id or f"lc_{uuid.uuid4().hex[:12]}"
        record = ToolCallRecord(
            name=name, args=dict(kwargs), status="planned",
            reason="Lifecycle tool selected by the model.", iteration=len(state.tools) + 1,
        )
        state.tools.append(record)

        def finish(content: str, *, status: str, summary: str, preview: Optional[str], ok: bool, **extra: Any) -> str:
            record.status = status  # type: ignore[assignment]
            # Contract text the tool returned is evidence a citation can be
            # checked against (citations.check_citations); nothing else is.
            evidence = lifecycle_evidence(name, summary) if status == "done" else []
            if status == "done":
                for cid, title in contract_titles(summary).items():
                    turn.titles.setdefault(cid, title)
            record.observation = {"summary": summary[:1500], "model_content": content, "lifecycle": True,
                                  **({"matches": evidence} if evidence else {}), **extra}
            state.react_scratchpad.append({
                "iteration": record.iteration, "tool": name, "status": status,
                "observation": {"summary": summary[:1500], **({"matches": evidence} if evidence else {})},
            })
            if preview is not None:
                limit = FULL_PREVIEW_CHARS if name in FULL_PREVIEW_TOOLS else SHORT_PREVIEW_CHARS
                turn.emit({
                    "type": "tool_call_result", "id": call_id, "name": name,
                    "result": preview[:limit], "truncated": len(preview) > limit, "ok": ok,
                })
            return content

        turn.counts[name] = turn.counts.get(name, 0) + 1
        cap = PER_TOOL_BUDGET.get(name)
        if cap is not None and turn.counts[name] > cap:
            msg = _budget_message(name, turn.counts[name], cap)
            return finish(msg, status="error", summary=msg, preview=msg, ok=False, tool_budget_exhausted=True)
        exhausted = tool_errors.budget_exceeded(state)
        if exhausted:
            msg = f"BUDGET_EXCEEDED: {exhausted}. Stop calling tools and answer from the data already gathered."
            return finish(msg, status="error", summary=msg, preview=msg, ok=False, tool_budget_exhausted=True)

        platform_error = False
        try:
            result = _run_with_heartbeat(
                lambda: tool.invoke(kwargs),
                on_beat=lambda elapsed: turn.emit({"type": "tool_progress", "id": call_id, "name": name, "elapsedSec": elapsed}),
            )
        except Exception as exc:  # the tool's own failure, reported to the model as ours
            logger.exception("lifecycle tool %s raised", name)
            platform_error = True
            result = json.dumps({"error": "tool_raised", "message": str(exc)[:500]})

        if isinstance(result, dict) and result.get("awaitingConfirmation"):
            preview = result.get("preview") if isinstance(result.get("preview"), dict) else {}
            proposal = {
                "type": "tool_call_awaiting_confirmation", "id": call_id, "name": name,
                "args": result.get("args") or kwargs, "preview": preview,
                "reversible": bool(result.get("reversible")), "source": "lifecycle",
            }
            turn.proposals.append(proposal)
            turn.emit(proposal)
            synthetic = json.dumps({
                "status": "awaiting_user_confirmation",
                "summary": preview.get("summary", ""),
                "note": "Nothing has changed yet. The user must click Apply to commit. "
                        "Tell them what you've prepared in 1-2 sentences.",
            })
            return finish(synthetic, status="done", summary=str(preview.get("summary") or "Proposed."), preview=None,
                          ok=True, proposal=True)

        text = result if isinstance(result, str) else json.dumps(result, default=str)
        # Our own error reports are stated plainly; everything that came from
        # a document is framed as data the model must not take orders from.
        content = text if platform_error else _untrusted(name, text)
        return finish(content, status="error" if platform_error else "done", summary=text, preview=text,
                      ok=not platform_error)

    return StructuredTool.from_function(
        func=_call, name=name, description=tool.description, args_schema=tool.args_schema,
    )


def lifecycle_tools(
    org_id: str,
    user_id: Optional[str],
    *,
    turn: LifecycleTurn,
    state: AgentRunState,
    build: Optional[Callable[[str, Optional[str]], Iterable[BaseTool]]] = None,
) -> List[StructuredTool]:
    """Every lifecycle tool, bound to this org and user, wrapped for the loop."""
    if build is None:
        from agents_service.tools import get_read_tools as build
    return [wrap_lifecycle_tool(tool, turn=turn, state=state) for tool in build(org_id, user_id)]
