"""Model-led LangGraph ReAct runner for ContractSense."""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, Optional

from utils.text_cleanup import get_formatted_citations


from .middleware import ActiveMiddlewareEngine
from .persistence import AgentRunStore
from .react_runtime import ContractReActRuntime
from .state import AgentResponse, AgentRunState, AgentStatus, ToolCallRecord

try:
    from langgraph.checkpoint.memory import MemorySaver
except Exception:  # pragma: no cover - optional dependency guard.
    MemorySaver = None  # type: ignore[assignment]


ToolExecutor = Callable[[ToolCallRecord, AgentRunState], Dict[str, Any]]

_SHARED_MEMORY_CHECKPOINTER = MemorySaver() if MemorySaver else None


class DeepContractAgentRunner:
    """Stable API wrapper around the unified ContractReActRuntime.

    The model chooses whether to answer, call retrieval/calculation tools, or
    request approval. This runner only applies backend safety, trace formatting,
    persistence, and response-shape compatibility.
    """

    def __init__(
        self,
        store: Optional[AgentRunStore] = None,
        tool_executor: Optional[ToolExecutor] = None,
        checkpointer: Optional[Any] = None,
        model: Optional[Any] = None,
        max_iterations: Optional[int] = None,
    ) -> None:
        self.store = store
        self.tool_executor = tool_executor
        self.checkpointer = checkpointer if checkpointer is not None else _SHARED_MEMORY_CHECKPOINTER
        self.model = model
        self.max_iterations = max_iterations
        self.middleware = ActiveMiddlewareEngine()

    def run(self, state: AgentRunState, on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None) -> AgentResponse:
        state.status = AgentStatus.RUNNING
        state.add_trace("input_guard", message_length=len(state.message))
        state = self.middleware.input_guard(state)
        if state.status != AgentStatus.COMPLETED:
            self._add_context_trace(state)
            state = self.middleware.model_guard(state)
            runtime = ContractReActRuntime(
                tool_executor=self.tool_executor,
                checkpointer=self.checkpointer,
                model=self.model,
                max_iterations=self.max_iterations,
            )
            state = runtime.run(state, checkpoint_config=self.checkpoint_config(state), on_event=on_event)
            state = self.middleware.tool_guard(state)
            if state.status == AgentStatus.WAITING_APPROVAL:
                state = self.middleware.approval_guard(state)
            elif state.status == AgentStatus.COMPLETED:
                state = self.middleware.answer_guard(state)
        self._persist(state)
        return self.response_from_state(state)

    def checkpoint_thread_id(self, state: AgentRunState) -> str:
        context = state.context
        scope_id = (
            context.contract_id
            or context.project_id
            or context.review_id
            or context.playbook_id
            or context.surface.value
            or "global"
        )
        run_scope = context.session_id or state.workflow_id
        raw_parts = ["contract-agent", state.user_id, scope_id, run_scope]
        return ":".join(str(part).replace(":", "_") for part in raw_parts if part)

    def checkpoint_config(self, state: AgentRunState) -> Dict[str, Any]:
        return {"configurable": {"thread_id": self.checkpoint_thread_id(state)}}

    def response_from_state(self, state: AgentRunState) -> AgentResponse:
        requires_approval = state.status == AgentStatus.WAITING_APPROVAL
        if state.answer:
            state.answer = re.sub(
                r"【(\d+(?:\s*,\s*\d+)*)】",
                lambda m: f"[{m.group(1)}]",
                state.answer
            )
        if not state.citation_details:
            state.citation_details = {}

        # Unify citation annotations using helper
        state.citation_annotations = get_formatted_citations(state.citation_details, state.citation_annotations)

        if "source_pages_display" not in state.citation_details:
            annotations = state.citation_annotations
            pages = set()
            for ann in annotations:
                p = ann.get("page") or ann.get("page_number")
                if p is not None:
                    pages.add(str(p))
            if pages:
                sorted_pages = sorted(list(pages), key=lambda x: int(x) if x.isdigit() else 999)
                if len(sorted_pages) == 1:
                    state.citation_details["source_pages_display"] = f"Page {sorted_pages[0]}"
                else:
                    state.citation_details["source_pages_display"] = f"Pages {', '.join(sorted_pages)}"
            else:
                state.citation_details["source_pages_display"] = ""

        return AgentResponse(
            answer=state.answer,
            workflow=state.workflow,
            confidence=state.confidence,
            reason=state.reason,
            citation_details=state.citation_details,
            citation_annotations=state.citation_annotations,
            citations=state.citation_annotations,
            tools_called=list(dict.fromkeys([t.name for t in state.tools])),
            artifacts=state.artifacts,
            workflow_id=state.workflow_id,
            workflow_status=state.status,
            requires_approval=requires_approval,
            approval_request=state.approval_request if requires_approval else None,
            tools=[tool.model_dump(mode="json") for tool in state.tools],
            agent_trace=[trace.model_dump(mode="json") for trace in state.traces],
            token_usage=state.token_usage,
            cost_usd=state.cost.cost_usd,
            created_review_id=state.created_review_id,
        )

    def _add_context_trace(self, state: AgentRunState) -> None:
        state.add_trace(
            "context_resolver",
            surface=state.context.surface.value,
            contract_id=state.context.contract_id,
            project_id=state.context.project_id,
            selected_document_count=len(state.context.selected_document_ids),
        )

    def _persist(self, state: AgentRunState) -> None:
        state.add_trace("persist_run", persisted=bool(self.store))
        state.add_trace("final_response", status=state.status.value)
        if state.answer:
            state.answer = re.sub(
                r"【(\d+(?:\s*,\s*\d+)*)】",
                lambda m: f"[{m.group(1)}]",
                state.answer
            )
        if self.store:
            self.store.save(state)
