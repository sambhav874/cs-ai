"""The platform assistant: one agent, on ContractSense's runtime.

POST /agents/agent/chat used to run draftLegal's orchestrator, a separate loop
with its own tools, prompt and memory, while ContractSense's agent — verified
citations, scope enforcement, project memory, typed tool errors — was reachable
from no screen. This runs the chat on ContractSense's runtime
(services/contract_agent/graph) and brings draftLegal's side along:

  • its lifecycle tools, wrapped (services/assistant/lifecycle.py)
  • its routing rules and chips, appended to ContractSense's prompt
    (services/assistant/prompt.py)
  • its skills and permission-denied tools, as a filter on the catalog
  • its stream contract, so the chat renders unchanged
    (services/assistant/frames.py)

Scope comes from the page the user is on. On a contract, ContractSense's
evidence tools read that contract's analysis copy; on a Space, the Space's
project; elsewhere only the lifecycle tools run, and portfolio_search reaches
every analysed contract. The conversation's earlier turns come from the API,
which persists them (routes/agents.ts), and are replayed with tool output
framed as untrusted again.
"""
# TODO(licence): bridges ContractSense's runtime and draftLegal's tools, prompt and replay seam (AGPL-3.0).

from __future__ import annotations

import asyncio
import json
import logging
import queue
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from services.assistant.frames import FrameTranslator, citation_frame, scrub_contract_ids
from services.assistant.lifecycle import LifecycleTurn, lifecycle_tools
from services.assistant.prompt import assistant_prompt
from services.contract_agent.graph.state import AgentContext, AgentRunState, AgentSurface
from services.contract_agent.graph.tools.registry import (
    APPROVAL_REQUIRED_TOOLS,
    LIFECYCLE_TOOLS,
    LIFECYCLE_WRITE_TOOLS,
    READ_ONLY_TOOLS,
)

logger = logging.getLogger(__name__)

# A research turn over several tools and a slow model can run minutes; an
# abandoned tab must not run forever.
HARD_TIMEOUT_SECONDS = 300
KEEPALIVE_SECONDS = 15
HISTORY_TURNS = 10
REPLAY_RESULT_CHARS = 8_000

# ContractSense tools that read documents in scope. With no contract or Space
# in scope they have nothing to read, so they are left out of the catalog
# rather than offered and refused.
SCOPED_TOOLS = READ_ONLY_TOOLS | APPROVAL_REQUIRED_TOOLS


@dataclass
class AssistantRequest:
    message: str
    session_id: str
    org_id: str
    user_id: str
    page_context: Optional[Dict[str, Any]] = None
    mentions: Optional[List[Dict[str, Any]]] = None
    skill_slug: Optional[str] = None
    skill_system_prompt: Optional[str] = None
    skill_allowed_tools: Optional[List[str]] = None
    denied_tools: Optional[List[str]] = None
    history: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class Scope:
    """Who is asking and what ContractSense can read for them."""

    cs_user_id: str
    context: AgentContext
    scoped: bool
    # ContractSense document id → platform contract id, for citations.
    platform_ids: Dict[str, str] = field(default_factory=dict)
    memory_context: str = ""


# ── Scope ────────────────────────────────────────────────────────────────────

def resolve_scope(req: AssistantRequest) -> Scope:
    """Map the caller and their page onto ContractSense's scope.

    The platform user is resolved to their ContractSense shadow (the org team
    decides what they can read); a contract page scopes to its analysis copy,
    a Space to its project. Anything that cannot be resolved leaves the turn
    unscoped rather than failing it: the lifecycle tools still work.
    """
    from core.platform_identity import platform_roles, resolve_platform_user
    from models.domain import UserInDB

    shadow = resolve_platform_user({
        "sub": req.user_id, "orgId": req.org_id, "type": "access", "roles": platform_roles(req.user_id),
    })
    user = UserInDB.model_validate(shadow)
    unscoped = Scope(cs_user_id=str(user.id), context=AgentContext(surface=AgentSurface.DASHBOARD,
                                                                   session_id=req.session_id), scoped=False)
    page = req.page_context or {}
    kind, page_id = page.get("type"), page.get("id")
    if not page_id:
        # No page, but the user @-mentioned a contract: scope to it, so its
        # evidence is read with verified citations rather than searched for.
        mentioned = next((m for m in (req.mentions or []) if m.get("kind") in {"contract", "space"} and m.get("id")), None)
        if mentioned:
            kind, page_id = mentioned["kind"], mentioned["id"]
    if not kind or not page_id or not user.teamIds:
        return unscoped
    try:
        if kind == "contract":
            return _contract_scope(req, user, str(page_id)) or unscoped
        if kind == "space":
            return _space_scope(req, user, str(page_id)) or unscoped
    except Exception as exc:  # scope is a convenience, never a reason to fail the turn
        logger.warning("assistant scope for %s %s not resolved: %s", kind, page_id, exc)
    return unscoped


def _contract_scope(req: AssistantRequest, user: Any, platform_contract_id: str) -> Optional[Scope]:
    from bson import ObjectId

    from api.routes.agent import check_contract_access
    from core.database import collection
    from services.platform_contracts import find_by_platform_id

    doc = find_by_platform_id(platform_contract_id, ObjectId(str(user.teamIds[0])), contracts=collection)
    if not doc or (doc.get("index") or {}).get("status") != "success":
        return None
    check_contract_access(doc, user)
    cs_id = str(doc["_id"])
    name = doc.get("contract_name") or cs_id
    project_id = str(doc["projectId"]) if doc.get("projectId") else None
    context = AgentContext(
        surface=AgentSurface.CONTRACT, contract_id=cs_id, project_id=project_id, session_id=req.session_id,
        selected_document_ids=[cs_id],
        displayed_document={"document_id": cs_id, "filename": name},
        attached_documents=[{"document_id": cs_id, "filename": name}],
        visible_state={"scope": "contract", "contract_name": name},
    )
    return Scope(cs_user_id=str(user.id), context=context, scoped=True,
                 platform_ids={cs_id: platform_contract_id},
                 memory_context=_memory(req, user, context))


def _space_scope(req: AssistantRequest, user: Any, space_id: str) -> Optional[Scope]:
    from bson import ObjectId

    from api.routes.agent import _load_indexed_project_documents
    from core.database import projects_collection
    from core.platform_identity import _platform_db
    from services.space_projects import ensure_space_project

    project = ensure_space_project(space_id, ObjectId(str(user.teamIds[0])),
                                   projects=projects_collection, platform_db=_platform_db())
    if not project:
        return None
    project_id = str(project["_id"])
    documents = _load_indexed_project_documents(project_id=project_id, current_user=user, include_content=False)
    attached = [{"document_id": str(d["_id"]), "filename": d.get("contract_name") or str(d["_id"])} for d in documents]
    context = AgentContext(
        surface=AgentSurface.PROJECT, project_id=project_id, session_id=req.session_id,
        selected_document_ids=[a["document_id"] for a in attached], attached_documents=attached,
        visible_state={"scope": "project", "document_count": len(attached)},
    )
    platform_ids = {str(d["_id"]): str(d.get("platformContractId")) for d in _platform_links(attached)}
    return Scope(cs_user_id=str(user.id), context=context, scoped=True, platform_ids=platform_ids,
                 memory_context=_memory(req, user, context))


def _platform_links(attached: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    from bson import ObjectId

    from core.database import collection

    ids = [ObjectId(a["document_id"]) for a in attached if ObjectId.is_valid(a["document_id"])]
    if not ids:
        return []
    return [d for d in collection.find({"_id": {"$in": ids}}, {"platformContractId": 1}) if d.get("platformContractId")]


def _memory(req: AssistantRequest, user: Any, context: AgentContext) -> str:
    """ContractSense's memory for this scope: project facts, events, preferences.

    The conversation itself is replayed from the thread, so the composer is
    asked only for what outlives it.
    """
    try:
        from api.routes.agent import _agent_memory, _memory_composer, _preference_blocks
        from services.memory import MemoryScope

        scope = MemoryScope(
            user_id=str(user.id), question=req.message, session_id=req.session_id,
            contract_id=context.contract_id or f"project:{context.project_id}",
            project_id=context.project_id, surface=context.surface.value,
        )
        return _memory_composer(_agent_memory()).compose(scope, extra_blocks=_preference_blocks(user)).text
    except Exception as exc:
        logger.warning("assistant memory not composed: %s", exc)
        return ""


# ── History ──────────────────────────────────────────────────────────────────

def history_messages(history: List[Dict[str, Any]]) -> List[BaseMessage]:
    """Earlier turns as model messages, tool calls included.

    Replaying the calls and their results is what lets "tell me about the
    second one" resolve to the id an earlier search returned. Results are
    framed as untrusted again: they were document-derived when first read.
    """
    from agents_service.untrusted import wrap_untrusted_document

    messages: List[BaseMessage] = []
    for turn in history[-HISTORY_TURNS * 2:]:
        role = turn.get("role")
        content = str(turn.get("content") or "")
        if role == "user" and content:
            messages.append(HumanMessage(content=content))
            continue
        if role != "assistant":
            continue
        calls = [c for c in (turn.get("toolCalls") or []) if isinstance(c, dict) and c.get("id") and c.get("name")]
        if calls:
            messages.append(AIMessage(content="", tool_calls=[
                {"id": str(c["id"]), "name": str(c["name"]), "args": c.get("args") or {}} for c in calls
            ]))
            for c in calls:
                result = str(c.get("result") or "")[:REPLAY_RESULT_CHARS]
                messages.append(ToolMessage(
                    content=wrap_untrusted_document(result, source=f"tool `{c['name']}` output (earlier turn)"),
                    tool_call_id=str(c["id"]),
                ))
        if content:
            messages.append(AIMessage(content=content))
    return messages


def _hints(req: AssistantRequest) -> str:
    """Page and @-mention hints, prepended to the user's message."""
    lines: List[str] = []
    page = req.page_context or {}
    if page.get("type") == "contract" and page.get("id"):
        lines.append(f'[Page context: the user is viewing contract id={page["id"]} ("{page.get("label") or "Untitled"}"). '
                     'Use this id when the question is about "this contract".]')
    elif page.get("type") == "space" and page.get("id"):
        lines.append(f'[Page context: the user is viewing Space id={page["id"]} ("{page.get("label") or "Untitled"}").]')
    mention_lines = []
    for m in (req.mentions or [])[:10]:
        kind, mid, label = m.get("kind"), m.get("id"), m.get("label") or "(unnamed)"
        if kind and mid:
            mention_lines.append(f'  • @{kind}:{mid} → "{label}"')
    if mention_lines:
        lines.append("[User-supplied entity mentions — ids are authoritative:\n" + "\n".join(mention_lines) + "]")
    return ("\n".join(lines) + "\n\n") if lines else ""


# Words that ask for a change. Deliberately broad: a false positive only costs
# the write tools' tokens; a miss leaves the assistant unable to act, so any
# doubt — and any conversation that already proposed a change — counts.
_CHANGE_WORDS = re.compile(
    r"\b(tag|untag|label|assign|reassign|owner|approve|reject|decline|delegate|route|submit|send|mark|set|"
    r"change|update|edit|modify|rename|retype|re-?analy[sz]e|comment|note|flag|annotate|request|draft|create|"
    r"prepare|generate|redline|rewrite|amend|apply|accept|sign|execute|remember|save|record|correct|fix|undo|"
    r"revert|remove|delete|add|renew|terminate|cancel|yes|yeah|yep|ok|okay|go ahead|do it|proceed|confirm|sure)\b",
    re.IGNORECASE,
)


def wants_writes(req: AssistantRequest) -> bool:
    """Whether this turn is offered the write tools and their rules.

    A lookup ("which contracts expire this year?") is most turns, and each of
    its model calls carried ~2.5k tokens of write tools and rules it could not
    use. They stay for a message that asks for a change, a skill that names a
    write tool, and any conversation that has already proposed one (so "yes,
    do it" works and replayed calls always name a bound tool).
    """
    if set(req.skill_allowed_tools or []) & LIFECYCLE_WRITE_TOOLS:
        return True
    for turn in req.history or []:
        for call in turn.get("toolCalls") or []:
            if isinstance(call, dict) and call.get("name") in LIFECYCLE_WRITE_TOOLS:
                return True
    return bool(_CHANGE_WORDS.search(req.message or ""))


def tool_filter(req: AssistantRequest, *, scoped: bool, writes: bool = True) -> Callable[[str], bool]:
    """A skill's allowlist, then the caller's denials; unscoped turns drop the
    document tools, and a turn that asks for no change drops the write tools.
    Denials apply last, so a skill cannot re-admit a tool the caller may not
    use."""
    allow = set(req.skill_allowed_tools or [])
    deny = set(req.denied_tools or [])

    def keep(name: str) -> bool:
        if name in deny:
            return False
        if not writes and name in LIFECYCLE_WRITE_TOOLS:
            return False
        if not scoped and name in SCOPED_TOOLS:
            return False
        # In scope, citations come from search_evidence(exact=), checked
        # against the document; contract_cite is the unscoped fallback.
        if scoped and name == "contract_cite":
            return False
        # An allowlist names lifecycle tools; the evidence tools stay, since a
        # skill about a contract still needs to read it.
        if allow and name in LIFECYCLE_TOOLS and name not in allow:
            return False
        return True

    return keep


# ── The run ──────────────────────────────────────────────────────────────────

@dataclass
class _Model:
    llm: Any
    provider: Optional[str]
    model: Optional[str]
    tier: str
    source: str


def _resolve_model(org_id: str, session_id: str) -> _Model:
    from agents_service.replay import mode as replay_mode, wrap as replay_wrap
    from services.contract_agent.graph.model_factory import build_chat_model
    from services.platform_models import resolve_platform_model

    # The eval seam (AGENT_REPLAY_MODE): replay serves recorded responses with
    # no provider and no key; record captures a live run keyed by session.
    if replay_mode() == "replay":
        return _Model(replay_wrap(None, session_id), "replay", "replay", "default", "platform")
    platform = resolve_platform_model(org_id, "default")
    llm = replay_wrap(build_chat_model(platform_model=platform, purpose="chat"), session_id)
    if platform is not None:
        return _Model(llm, platform.provider, platform.model, platform.tier, platform.source)
    return _Model(llm, getattr(llm, "_llm_type", None), getattr(llm, "model_name", None) or getattr(llm, "model", None),
                  "default", "platform")


def run_assistant(
    req: AssistantRequest,
    emit: Callable[[Dict[str, Any]], None],
    cancel_check: Callable[[], bool],
    *,
    scope: Optional[Scope] = None,
    model: Optional[_Model] = None,
    tool_executor: Optional[Callable] = None,
    build_lifecycle: Optional[Callable] = None,
    store: Any = None,
) -> Dict[str, Any]:
    """One turn. Emits frames through `emit`; returns what the stream ends with.

    Dependencies are injectable so the whole turn runs in tests against a
    scripted model and fake tools.
    """
    from services.contract_agent.graph.runner import DeepContractAgentRunner

    scope = scope or resolve_scope(req)
    model = model or _resolve_model(req.org_id, req.session_id)

    state = AgentRunState(
        user_id=scope.cs_user_id,
        message=(_hints(req) + req.message)[:4000],
        context=scope.context,
        memory_context=scope.memory_context,
    )
    turn = LifecycleTurn(emit=emit)
    tools = lifecycle_tools(req.org_id, req.user_id, turn=turn, state=state, build=build_lifecycle)
    translator = FrameTranslator(
        emit, lifecycle_names={t.name for t in tools},
        on_tool_call=lambda call_id: setattr(turn, "current_call_id", call_id),
    )

    if tool_executor is None:
        from api.routes.agent import _stream_agent_tool_executor as tool_executor
    if store is None:
        from api.routes.agent import _agent_run_store

        store = _agent_run_store()

    writes = wants_writes(req)
    runner = DeepContractAgentRunner(
        store=store,
        tool_executor=tool_executor,
        model=model.llm,
        extra_tools=tools,
        extra_system_prompt=assistant_prompt(
            scoped=scope.scoped, skill_slug=req.skill_slug, skill_prompt=req.skill_system_prompt, writes=writes,
        ),
        history_messages=history_messages(req.history),
        tool_filter=tool_filter(req, scoped=scope.scoped, writes=writes),
    )
    response = runner.run(state, on_event=translator, cancel_check=cancel_check)
    translator.flush()

    card = False
    if response.requires_approval and response.approval_request:
        # ContractSense's own approval-gated writes (remember a fact, extract
        # KPIs, tabular review...) become the same Apply card as a lifecycle
        # write; Apply reaches the workflow through the API.
        approval = response.approval_request
        emit({
            "type": "tool_call_awaiting_confirmation",
            "id": f"wf_{response.workflow_id}",
            "name": approval.action,
            "args": {"workflowId": response.workflow_id},
            "preview": {"summary": approval.title, "description": approval.description},
            "reversible": False,
            "source": "intelligence",
        })
        card = True
    card = card or bool(turn.proposals)

    # The answer as the user keeps it: raw contract ids replaced by titles.
    # The streamed text is replaced by it (the `final` frame below).
    response.answer = scrub_contract_ids(response.answer, turn.titles)

    if not translator.streamed.strip() and response.answer.strip():
        # Answers the runtime did not stream: an approval pause, a refusal,
        # the answer assembled from observations.
        translator.token(response.answer)
        translator.flush()

    cites = citation_frame(response.citation_annotations, platform_ids=scope.platform_ids)
    if cites:
        emit(cites)
    if response.answer.strip() and response.answer.strip() != translator.streamed.strip():
        emit({"type": "final", "answer": response.answer})

    if not translator.streamed.strip() and not card:
        return {"type": "error", "error": (
            "The model returned an empty response — no answer was produced. "
            "This is usually transient; try asking again or rephrasing."
        )}
    usage = response.token_usage
    return {
        "type": "done", "session_id": req.session_id,
        "provider": model.provider, "model": model.model, "tier": model.tier, "source": model.source,
        "usage": {"inputTokens": usage.input_tokens, "outputTokens": usage.output_tokens,
                  "modelCalls": response.model_calls},
        "workflowId": response.workflow_id,
    }


def _sse(frame: Dict[str, Any]) -> str:
    return f"data: {json.dumps(frame, default=str)}\n\n"


async def stream_assistant(
    req: AssistantRequest,
    *,
    is_disconnected: Callable[[], Any],
    run: Callable[..., Dict[str, Any]] = run_assistant,
    hard_timeout: float = HARD_TIMEOUT_SECONDS,
) -> AsyncIterator[str]:
    """The turn as SSE. The run is synchronous, so it runs on a thread and its
    frames cross a queue; the stream watches for a closed tab and the clock."""
    frames: "queue.Queue[tuple]" = queue.Queue()
    cancelled = threading.Event()

    def worker() -> None:
        try:
            last = run(req, lambda f: frames.put(("frame", f)), cancelled.is_set)
            frames.put(("end", last))
        except Exception as exc:  # reported to the user, logged in full here
            logger.exception("assistant turn failed")
            frames.put(("end", {"type": "error", "error": _error_text(exc)}))

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    started = last_emit = time.monotonic()
    while True:
        try:
            kind, frame = frames.get_nowait()
        except queue.Empty:
            if not thread.is_alive() and frames.empty():
                yield _sse({"type": "error", "error": "The assistant stopped without an answer."})
                break
            if await is_disconnected():
                cancelled.set()
                return
            if time.monotonic() - started >= hard_timeout:
                cancelled.set()
                yield _sse({"type": "error", "error": "The run exceeded its time budget and was stopped."})
                break
            if time.monotonic() - last_emit >= KEEPALIVE_SECONDS:
                last_emit = time.monotonic()
                yield ": keepalive\n\n"
            await asyncio.sleep(0.05)
            continue
        yield _sse({"session_id": req.session_id, **frame})
        last_emit = time.monotonic()
        if kind == "end":
            break
    yield "data: [DONE]\n\n"


def _error_text(exc: Exception) -> str:
    name = type(exc).__name__
    if name == "PlatformCostCapExceeded":
        return "Daily AI spend cap reached for this organization."
    if name == "PlatformIdentityError":
        return "Your account could not be matched to this workspace."
    return f"{name}: {str(exc)[:300]}"
