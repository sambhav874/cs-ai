"""Tool-calling agent runtime for ContractSense.

A simple, model-native tool-calling loop:
  1. Build [SystemMessage, HumanMessage].
  2. Invoke the model with tools bound.
  3. If the model returns tool_calls → execute them, append ToolMessages, loop.
  4. If the model returns text → that is the final answer.

No manual Thought/Observation prompt engineering. No streaming accumulation.
No separate verification pass. The model handles all reasoning internally.
"""


from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool

from core.config import settings

from services.contract_agent import citations
from services.contract_agent.react_agent import ApprovalRequiredError
from services.contract_agent.system_prompt import build_adaptive_system_prompt

from .approvals import ApprovalManager
from .model_factory import build_chat_model
from .state import (
    AgentRunState,
    AgentStatus,
    TabularColumnProposal,
    TabularReviewProposal,
    ToolCallRecord,
)
from .tools import errors as tool_errors
from .tools.langchain_tools import build_langchain_tools
from .tools.registry import FORBIDDEN_TOOL_NAMES


ToolExecutor = Callable[[ToolCallRecord, AgentRunState], Dict[str, Any]]

logger = logging.getLogger(__name__)


# ── Synthesis-turn capability flag (F-04) ─────────────────────────────────────
#
# The loop used to append a synthesis HumanMessage and make a second full model
# call every time a tool returned evidence-shaped content. That was a workaround
# for weaker tool-calling models that would not cite from evidence in the turn
# they received it; current models do.
#
# Measured against a held-constant scripted model in
# testing/backend/tests/test_synthesis_turn_flag.py:
#
#   single retrieval round   2 model calls either way. A tool-calling loop needs
#                            one call to request the tool and one to consume the
#                            result, so the synthesis turn only relabels the
#                            second call. There is no 2x saving to be had here.
#   two retrieval rounds     on: 3 calls, and only ONE search runs — the model's
#                            second retrieval request arrives on the synthesis
#                            call, which has tools unbound, so it is discarded.
#                            off: 3 calls and both searches run.
#
# So the flag is not really about cost; the cost metric stays flat. What it costs
# is coverage on anything multi-hop, which is why the default is off. Turn it
# back on for a specific provider only if the eval shows that provider's
# citation-support rate needs it.
DEFAULT_SYNTHESIS_TURN_PROVIDERS: frozenset[str] = frozenset()


def _synthesis_turn_enabled(provider: str) -> bool:
    """Whether `provider` needs the extra synthesis model call.

    AGENT_SYNTHESIS_TURN_PROVIDERS overrides the default table without a deploy:
    a comma-separated provider list, or `all` / `none`. Unset means the table.
    """
    configured = os.environ.get("AGENT_SYNTHESIS_TURN_PROVIDERS")
    normalized = str(provider or "").strip().lower()
    if configured is None:
        return normalized in DEFAULT_SYNTHESIS_TURN_PROVIDERS
    configured = configured.strip().lower()
    if configured in {"", "none", "0", "false"}:
        return False
    if configured in {"all", "1", "true"}:
        return True
    return normalized in {item.strip() for item in configured.split(",") if item.strip()}



# What each tool is doing, in the words someone waiting would use. Keyed on the
# tool and, where one tool does several different jobs, on the view it was asked
# for — "checking the rate schedules against the contract" and "reading a rate
# card" are the same tool and not the same wait.
# Text is held until a turn has written this much, so a tool-calling turn's
# stray "Let me check…" never reaches the transcript only to be replaced.
_STREAM_COMMIT_CHARS = 24


_TOOL_STATUS: Dict[str, str] = {
    "search_evidence": "Searching the documents",
    "read_document": "Reading a document",
    "list_documents": "Listing the documents in scope",
    "calculate_from_evidence": "Checking the arithmetic",
    "get_kpi_context": "Reading tracked KPIs",
    "project_memory": "Reading project memory",
    "read_schedules": "Reading rate schedules",
    "remember_fact": "Preparing a fact to save",
    "correct_fact": "Preparing a correction",
    "extract_kpis": "Drafting KPI candidates",
    "propose_tabular_review": "Preparing a tabular review",
    "generate_tabular_review": "Filling in the review",
    "replicate_document": "Preparing to copy a document",
}

_VIEW_STATUS: Dict[Tuple[str, str], str] = {
    ("project_memory", "governing"): "Working out which documents still govern",
    ("project_memory", "conflicts"): "Checking whether the documents disagree",
    ("project_memory", "events"): "Reading the project history",
    ("project_memory", "index"): "Reading the project index",
    ("read_schedules", "values"): "Reading the rates themselves",
    ("read_schedules", "history"): "Reading how the rates changed",
    ("read_schedules", "escalation"): "Checking the rises against the contract",
}


def _tool_status_message(name: str, args: Dict[str, Any]) -> str:
    view = str((args or {}).get("view") or "").strip().lower()
    specific = _VIEW_STATUS.get((name, view))
    if specific:
        return f"{specific}…"
    return f"{_TOOL_STATUS.get(name, f'Running {name}')}…"


class ContractReActRuntime:
    """Native tool-calling agent loop for ContractSense.

    Each iteration:
      1. Calls model.invoke(messages) with tools bound.
      2. If the response contains tool_calls → execute each tool, append
         AIMessage + ToolMessage(s) to the conversation, loop.
      3. If the response is plain text → final answer, stop.

    No manual Thought/Observation prompt construction. No streaming
    accumulation. No separate verification pass.
    """

    def __init__(
        self,
        *,
        tool_executor: Optional[ToolExecutor] = None,
        fallback_executor: Optional[ToolExecutor] = None,
        checkpointer: Optional[Any] = None,
        model: Optional[Any] = None,
        max_iterations: Optional[int] = None,
    ) -> None:
        self.tool_executor = tool_executor
        self.fallback_executor = fallback_executor
        self.checkpointer = checkpointer
        self.model = model
        self._config_max_iterations = max(
            1,
            int(max_iterations or getattr(settings, "contract_agent_max_react_iterations", 10) or 10),
        )
        self.max_iterations = self._config_max_iterations
        self.approvals = ApprovalManager()
        # Characters of the current turn's answer already sent to the client.
        self._streamed_answer_chars = 0

    # ── Public entry point ─────────────────────────────────────────────────

    def run(
        self,
        state: AgentRunState,
        *,
        checkpoint_config: Optional[Dict[str, Any]] = None,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> AgentRunState:
        """`cancel_check`, if given, is polled once per ReAct iteration (F-10).

        It cannot interrupt a model call already in flight — there is no
        preemption inside a blocking HTTP request to the provider — but it
        stops the *next* iteration from starting, which is what actually
        matters for an abandoned tab: without this, a disconnected client
        still drove the loop to its full iteration budget.
        """
        tools = build_langchain_tools(
            state=state,
            tool_executor=self.tool_executor,
            fallback_executor=self.fallback_executor,
        )
        self.max_iterations = self._config_max_iterations

        system_prompt = build_adaptive_system_prompt(
            tools=tools,
            message=state.message,
            document_count=len(state.context.selected_document_ids or []),
            attached_documents=state.context.attached_documents or None,
        )

        state.add_trace(
            "agent_start",
            message=state.message,
            surface=state.context.surface.value if hasattr(state.context, "surface") and hasattr(state.context.surface, "value") else str(state.context.surface),
            provider=state.ai_provider,
            project_id=state.context.project_id,
            contract_id=state.context.contract_id,
        )

        model: Any = None
        try:
            model = self.model or build_chat_model(state)
            return self._tool_call_loop(
                state, model=model, tools=tools, system_prompt=system_prompt,
                on_event=on_event, cancel_check=cancel_check,
            )
        except ApprovalRequiredError as exc:
            self._apply_approval_payload(state, exc.payload)
            return state
        except Exception as exc:
            approval_payload = self._pending_approval_payload(state)
            if approval_payload:
                self._apply_approval_payload(state, approval_payload)
                return state
            state.add_trace("agent_error", error=str(exc)[:800])
            return self._finish_cannot_answer(
                state,
                answer=self._model_failure_answer(exc),
                reason=str(exc)[:800],
            )

    # ── Core tool-calling loop ─────────────────────────────────────────────

    def _tool_call_loop(
        self,
        state: AgentRunState,
        *,
        model: Any,
        tools: Sequence[BaseTool],
        system_prompt: str,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> AgentRunState:
        self._on_event = on_event  # stored so finish helpers can emit events
        tools_by_name: Dict[str, BaseTool] = {t.name: t for t in tools}
        tool_model = model.bind_tools(tools) if hasattr(model, "bind_tools") else model

        # Build initial conversation messages
        user_message = self._build_user_message(state)
        messages: List[BaseMessage] = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_message),
        ]

        cancelled = False
        for iteration in range(1, self.max_iterations + 1):
            if cancel_check and cancel_check():
                cancelled = True
                state.add_trace("run_cancelled", iteration=iteration)
                break

            if on_event:
                on_event("status", {"message": f"Thinking (step {iteration})", "iteration": iteration})

            state.add_trace(
                "prompt_sent",
                iteration=iteration,
                system_prompt_summary=system_prompt[:200] + "..." if len(system_prompt) > 200 else system_prompt,
                user_message_snippet=user_message[:300],
                messages_count=len(messages),
            )

            response = self._invoke_tool_call(
                tool_model, messages, state, on_event=on_event, iteration=iteration
            )
            state.react_iterations = max(state.react_iterations, iteration)

            _log_agent_turn(
                state.workflow_id,
                iteration,
                messages,
                response_text=_content_text(getattr(response, "content", "")),
                tool_names=[c.get("name") for c in (getattr(response, "tool_calls", None) or [])],
                response_metadata=getattr(response, "response_metadata", None),
            )

            reasoning = _extract_reasoning(response)
            if reasoning and on_event:
                on_event("thinking", {"message": reasoning, "iteration": iteration})

            tool_calls = list(getattr(response, "tool_calls", None) or [])

            state.add_trace(
                "response_received",
                iteration=iteration,
                tool_calls_count=len(tool_calls),
                tool_names=[c.get("name") for c in tool_calls] if tool_calls else [],
                reasoning=reasoning[:200] if reasoning else None,
                content_snippet=response.content[:300] if isinstance(response.content, str) else "",
            )

            if tool_calls:
                # Append the AI response to message history
                messages.append(response)
                # Execute each tool and collect ToolMessages
                tool_messages = self._execute_tool_calls(
                    state, tool_calls, tools_by_name, iteration, on_event=on_event
                )
                messages.extend(tool_messages)

                # Approval is a turn-level decision. Checking only after every
                # sibling has returned prevents a side-effect proposal from
                # hiding evidence that was requested in the same model turn.
                approval_payload = self._pending_approval_payload(state)
                if approval_payload:
                    self._apply_approval_payload(state, approval_payload)
                    return state

                # Synthesis turn: after tools return evidence chunks, feed them
                # back to the same agent (without tools bound) so it produces a
                # properly cited answer from the evidence, rather than answering
                # inline in the same turn it calls tools.
                #
                # Off by default — see DEFAULT_SYNTHESIS_TURN_PROVIDERS. With it
                # off the loop falls through to the next iteration, where the
                # model sees the same evidence with tools still bound and can
                # either answer or retrieve again.
                provider_name = self._provider_name(state)
                if (
                    tool_messages
                    and _has_evidence_content(tool_messages)
                    and iteration < self.max_iterations
                    and _synthesis_turn_enabled(provider_name)
                ):
                    state.add_trace(
                        "synthesis_turn", iteration=iteration,
                        action="synthesize_evidence",
                        reason_summary="Evidence retrieved; feeding chunks back to agent for cited answer.",
                    )
                    synthesis_prompt = (
                        f"Original query: {state.message}\n\n"
                        f"Using only the evidence returned by the tools above, answer the query naturally and directly. "
                        f"Do not expose internal IDs, UUIDs, database IDs, or tool output. "
                        f"Use citations only when the user asks for sources, when quoting contract language, "
                        f"or when a material/legal conclusion needs support. If citations are needed, use brief inline "
                        f"markers like [1], [2] and include the structured <CITATIONS> JSON block at the end; otherwise omit it."
                    )
                    messages.append(HumanMessage(content=synthesis_prompt))

                    synth_iteration = iteration + 1
                    if on_event:
                        on_event("status", {"message": "Writing answer…", "iteration": synth_iteration})
                    # Groq rejects tool_choice=none on a model with tools bound,
                    # so it keeps the bound model; others drop tools to force a
                    # text answer.
                    synthesis_model = tool_model if "groq" in provider_name else model
                    answer = self._stream_text_response(synthesis_model, messages, state, on_event, synth_iteration)
                    _log_agent_turn(
                        state.workflow_id,
                        synth_iteration,
                        messages,
                        response_text=answer,
                        label="synthesis",
                    )
                    if answer:
                        state.react_iterations = max(state.react_iterations, iteration + 1)
                        return self._finish_answer(
                            state, answer=answer,
                            reason="Agent synthesized cited answer from tool evidence.",
                        )

                continue  # next iteration

            # No tool calls → this is the final answer
            # _message_text correctly strips thinking blocks from Claude responses
            answer = _message_text(response).strip()
            if answer:
                # Only when the turn was not streamed. Sending it again after
                # the client has already been given it word by word would
                # duplicate the whole answer on screen.
                if on_event and not getattr(self, "_streamed_answer_chars", 0):
                    on_event("delta", {"text": answer, "iteration": iteration})
                state.add_trace(
                    "model_step",
                    iteration=iteration,
                    action="final_answer",
                    reason_summary="Model produced the final answer.",
                )
                return self._finish_answer(state, answer=answer, reason="Tool-calling agent produced the final answer.")

        # Step limit reached, or the caller cancelled the run (client
        # disconnected / wall-clock timeout) — synthesize from whatever was
        # observed rather than discarding evidence already retrieved.
        answer = _answer_from_observations(state)
        if answer:
            return self._finish_answer(
                state,
                answer=answer,
                reason=(
                    "Run cancelled before completion; answer synthesized from observed evidence."
                    if cancelled else
                    "Agent reached step limit; answer synthesized from observed evidence."
                ),
            )
        return self._finish_cannot_answer(
            state,
            answer="I could not produce a final answer from the available scoped evidence.",
            reason=(
                "Tool-calling loop was cancelled before a final answer."
                if cancelled else
                "Tool-calling loop ended without a final answer."
            ),
        )

    def _provider_name(self, state: AgentRunState) -> str:
        """The provider this run resolved to, normalized the way model_factory does.

        Reused rather than re-derived so a flag keyed on "anthropic" and a model
        built for "claude" cannot disagree.
        """
        from .model_factory import _normalize_provider_name

        return _normalize_provider_name(
            state.ai_provider or getattr(settings, "ai_provider", None) or "groq"
        )

    def _build_user_message(self, state: AgentRunState) -> str:
        context = state.context
        selected_ids = context.selected_document_ids or context.reference_contract_ids
        memory = state.memory_context.strip() if state.memory_context else "No prior conversation memory for this session."

        attached = context.attached_documents or []
        doc_lines = [
            f"  - doc-{i}: {doc.get('filename') or doc.get('name') or 'Unknown'} (ID: {doc.get('document_id') or doc.get('id') or '?'})"
            for i, doc in enumerate(attached)
        ]
        doc_inventory = "\n".join(doc_lines) if doc_lines else "No documents attached."

        return (
            f"User request:\n{state.message}\n\n"
            f"Conversation memory:\n{memory}\n\n"
            f"Documents in scope ({len(attached)}):\n{doc_inventory}\n\n"
            f"Authorized scope:\n"
            f"- surface: {context.surface.value}\n"
            f"- project_id: {context.project_id or 'N/A'}\n"
            f"- contract_id: {context.contract_id or 'N/A'}\n"
            f"- selected_document_ids: {selected_ids}\n\n"
            # Routing policy is stated once, in the system prompt's coverage-vs-retrieval
            # rule and in the tool descriptions. Restating it per turn only made three
            # copies to keep in sync.
            "Choose the tool that matches the user's intent. "
            "Answer conversationally and directly. "
            "Keep internal identifiers private. Add sources only when they are needed or requested."
        )

    def _invoke_tool_call(
        self,
        tool_model: Any,
        messages: list,
        state: "AgentRunState",
        *,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        iteration: int = 1,
    ) -> Any:
        """One model turn, streamed when the provider allows it.

        This call has to be able to come back either way — as tool calls, or as
        the final answer — which is why it used `invoke()` and why the answer
        arrived as a single chunk after the model had finished writing all of
        it. Streaming here forwards the answer as it is written, and costs
        nothing when the turn turns out to be a tool call: a tool-calling turn
        emits little or no text, and what it does emit is held back until the
        turn proves to be an answer.

        Falls back to `invoke()` whenever streaming is unavailable or fails, so
        a provider that cannot stream a tool-bound call still works — it just
        gets the old behaviour.
        """
        state.model_calls += 1
        self._streamed_answer_chars = 0
        streamed = self._stream_tool_call(tool_model, messages, state, on_event, iteration)
        if streamed is not None:
            return streamed
        response = tool_model.invoke(messages)
        self._add_token_usage_from_message(state, response)
        return response

    def _stream_tool_call(
        self,
        tool_model: Any,
        messages: list,
        state: "AgentRunState",
        on_event: Optional[Callable[[str, Dict[str, Any]], None]],
        iteration: int,
    ) -> Any:
        """Stream one tool-bound turn, or return None to fall back to invoke().

        Text is buffered until the turn has produced enough of it to be an
        answer rather than the stray prose a model sometimes emits alongside a
        tool call. Emitting eagerly would put "Let me check the schedules." in
        the transcript and then replace it, which reads as the agent changing
        its mind.
        """
        if not hasattr(tool_model, "stream"):
            return None

        aggregate = None
        emitted = 0
        buffered: List[str] = []
        try:
            for chunk in tool_model.stream(messages):
                aggregate = chunk if aggregate is None else aggregate + chunk
                self._add_token_usage_from_message(state, chunk)

                if not on_event:
                    continue
                # A turn that has started calling tools is not writing an
                # answer; anything it says alongside the call is not the reply.
                if getattr(aggregate, "tool_calls", None) or getattr(
                    aggregate, "tool_call_chunks", None
                ):
                    buffered.clear()
                    emitted = -1
                    continue
                if emitted < 0:
                    continue

                text = _message_text(chunk)
                if not text:
                    continue
                buffered.append(text)
                pending = "".join(buffered)
                if emitted == 0 and len(pending) < _STREAM_COMMIT_CHARS:
                    continue
                on_event("delta", {"text": pending, "iteration": iteration})
                emitted += len(pending)
                buffered.clear()
        except Exception as exc:
            # Known provider limitations on streaming a tool-bound call. The
            # run must not fail over a delivery detail, and nothing has been
            # sent to the client unless text was already committed.
            logger.warning("Streaming tool call failed (%s); falling back to invoke()", exc)
            if emitted > 0:
                # Text is already on the client's screen. Re-running the turn
                # would duplicate it, so keep what the stream produced.
                return aggregate
            return None

        if aggregate is None:
            return None
        if on_event and emitted >= 0 and buffered:
            on_event("delta", {"text": "".join(buffered), "iteration": iteration})
            emitted += len("".join(buffered))
        # How much of this turn's text the client already has. The loop below
        # emits the final answer as one delta for the non-streaming path, and
        # would otherwise send it a second time on top of what was streamed.
        # One runtime per run (see runner.run), so this is not shared state.
        self._streamed_answer_chars = max(0, emitted)
        return aggregate

    def _stream_text_response(
        self,
        model: Any,
        messages: list,
        state: "AgentRunState",
        on_event: Optional[Callable[[str, Dict[str, Any]], None]],
        iteration: int,
    ) -> str:
        """Stream a text-only model call, emitting SSE delta events per chunk.
        Falls back to invoke() for models that don't support streaming."""
        # One logical turn regardless of whether it lands on stream() or the
        # invoke() fallback below.
        state.model_calls += 1
        if not hasattr(model, "stream"):
            response = model.invoke(messages)
            self._add_token_usage_from_message(state, response)
            return _message_text(response).strip()

        assembled: list[str] = []
        try:
            for chunk in model.stream(messages):
                self._add_token_usage_from_message(state, chunk)

                reasoning = _extract_reasoning(chunk)
                if reasoning and on_event:
                    on_event("thinking", {"message": reasoning, "iteration": iteration})

                chunk_text = _message_text(chunk)
                if not chunk_text:
                    continue

                assembled.append(chunk_text)
                if on_event:
                    on_event("delta", {"text": chunk_text, "iteration": iteration})

        except Exception as exc:
            exc_str = str(exc)
            # Groq: reasoning_format=parsed incompatible with streaming
            # Groq: tool_choice=none conflict — both are known limitations, fall back silently
            if "tool choice is none" in exc_str.lower() or "reasoning_format" in exc_str.lower():
                pass  # silent fallback
            else:
                import logging
                logging.getLogger(__name__).warning(
                    "model.stream() failed (%s); falling back to invoke()", exc
                )
            response = model.invoke(messages)
            self._add_token_usage_from_message(state, response)
            text = _message_text(response).strip()
            if text and on_event:
                on_event("delta", {"text": text, "iteration": iteration})
            return text

        return "".join(assembled).strip()

    def _execute_tool_calls(
        self,
        state: AgentRunState,
        tool_calls: List[Dict[str, Any]],
        tools_by_name: Dict[str, BaseTool],
        iteration: int,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> List[ToolMessage]:
        """Execute all tool calls from one model response and return ToolMessages."""
        tool_messages: List[ToolMessage] = []

        for call in tool_calls:
            name = str(call.get("name") or "").strip()
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            call_id = str(call.get("id") or f"call_{iteration}_{name}")

            state.add_trace(
                "model_step", iteration=iteration, action="tool_call",
                tool=name or None, reason_summary="Model selected a tool call.",
                # The arguments are what make one call distinguishable from
                # another. Two reads of the same tool with different views are
                # the same line without them, and the persisted trace is what a
                # reloaded conversation renders — the live stream already sends
                # these to the client, so this is the same data, not more of it.
                args=args,
            )

            if on_event:
                on_event("tool_call", {"name": name, "args": args, "iteration": iteration})
                # A named progress line, not a spinner. A user watching
                # "Thinking…" for eight seconds cannot tell a working run from
                # a stuck one; "Reading rate schedules…" is the same wait and a
                # different experience.
                on_event(
                    "status",
                    {"message": _tool_status_message(name, args), "iteration": iteration},
                )

            # Reject forbidden / unknown tools
            if name in FORBIDDEN_TOOL_NAMES or name.startswith("send_") or name not in tools_by_name:
                self._record_rejected_tool_call(state, name=name or "unknown", args=args, iteration=iteration)
                if on_event:
                    on_event("tool_result", {
                        "name": name or "unknown",
                        "summary": "Tool rejected.",
                        "status": "rejected",
                        "iteration": iteration,
                    })
                tool_messages.append(
                    ToolMessage(
                        content=f"Tool '{name}' is not available or not permitted.",
                        tool_call_id=call_id,
                    )
                )
                continue

            try:
                result = tools_by_name[name].invoke(args)
                # Observation is recorded inside the tool wrapper (langchain_tools.py)
                content = ""
                summary = "Done."
                status = "done"

                if state.tools:
                    last = state.tools[-1]
                    if last.name == name:
                        obs = last.observation
                        status = str(obs.get("status") or last.status) if isinstance(obs, dict) else last.status
                        if isinstance(obs, dict):
                            summary = str(obs.get("summary") or "Done.")
                            if obs.get("status") == "approval_required":
                                summary = str(obs.get("message") or "Approval required.")
                            if "search_results" in obs:
                                content = obs["search_results"]
                            elif "snippet" in obs:
                                content = obs["snippet"]
                            elif "outline" in obs:
                                content = obs["outline"]
                            else:
                                content = json.dumps(obs, default=str)
                        else:
                            content = str(obs)
                            summary = content

                if not content:
                    if isinstance(result, dict):
                        summary = result.get("summary") or "Done."
                        if "search_results" in result:
                            content = result["search_results"]
                        elif "snippet" in result:
                            content = result["snippet"]
                        elif "outline" in result:
                            content = result["outline"]
                        else:
                            content = json.dumps(result, default=str)
                    else:
                        content = str(result)
                        summary = content

                if on_event:
                    on_event("tool_result", {
                        "name": name,
                        "summary": summary,
                        "status": status,
                        "iteration": iteration,
                    })

                state.add_trace(
                    "tool_executed",
                    iteration=iteration,
                    tool=name,
                    status=status,
                    summary=summary[:300] if len(summary) > 300 else summary,
                    result_length=len(content or ""),
                )

                tool_messages.append(
                    ToolMessage(
                        content=content or "Tool executed.",
                        tool_call_id=call_id,
                    )
                )

            except ApprovalRequiredError as exc:
                # Compatibility for an older wrapper that still raises. Keep
                # the batch moving; the turn-boundary scan below owns the gate.
                content = json.dumps(exc.payload, default=str)
                if on_event:
                    on_event("tool_result", {
                        "name": name,
                        "summary": "Approval required.",
                        "status": "approval_required",
                        "iteration": iteration,
                    })
                tool_messages.append(ToolMessage(content=content, tool_call_id=call_id))
                continue

            except Exception as exc:
                # A typed envelope, not a raw string: the model needs to know
                # whether this is a scope denial (never retry), a no-match
                # (rephrase or concede), bad arguments (fix and retry), or a
                # provider blip (already retried once by the tool wrapper).
                kind = tool_errors.classify(exc)
                envelope = tool_errors.envelope(kind, tool=name, detail=str(exc))
                error_text = envelope["summary"]
                state.add_trace(
                    "tool_result",
                    iteration=iteration,
                    tool=name,
                    status="error",
                    kind=kind.value,
                    summary=error_text[:500],
                )
                if on_event:
                    on_event("tool_result", {
                        "name": name,
                        "summary": error_text,
                        "status": "error",
                        "kind": kind.value,
                        "iteration": iteration,
                    })
                tool_messages.append(
                    ToolMessage(content=error_text, tool_call_id=call_id)
                )

        return tool_messages

    # ── Finish helpers ─────────────────────────────────────────────────────

    def _finish_answer(self, state: AgentRunState, *, answer: str, reason: str) -> AgentRunState:
        """Wrap up with a successful answer."""
        if _has_rejected_forbidden_tool(state):
            state.verifier_issues.append("forbidden_tool_rejected")
            return self._finish_cannot_answer(
                state,
                answer=(
                    "I cannot perform or assist with that action because it is outside the safe, "
                    "authorized ContractSense tool boundary. I can still answer questions using scoped contract evidence."
                ),
                reason="Forbidden or unknown model-selected tool was rejected before final answer.",
            )
        return self._finish_final_answer(state, answer=answer, reason=reason)

    def _finish_final_answer(self, state: AgentRunState, *, answer: str, reason: str) -> AgentRunState:
        # Steps 1-2 of the citation pipeline: normalize markers, parse the
        # model's <CITATIONS> block, resolve doc labels to documents, enrich
        # pages from observations. Validation, renumbering and marker rewriting
        # happen later in middleware.answer_guard — see services/contract_agent/
        # citations.py for why the order matters.
        if not state.citation_annotations:
            answer, annotations, style = citations.resolve_for_answer(answer, state)
            if annotations:
                state.citation_annotations = annotations
                state.citation_details = {
                    **(state.citation_details or {}),
                    "citation_style": style,
                }
        else:
            answer = citations.strip_citation_block(citations.normalize_markers(answer))

        state.answer = answer.strip()
        state.reason = reason
        state.status = AgentStatus.COMPLETED
        state.react_complete = True
        self._apply_answer_metadata(state)
        state.add_trace("verify_answer", issue_count=len(state.verifier_issues))
        state.add_trace(
            "final",
            action="final_answer",
            confidence=state.confidence,
            model_calls=state.model_calls,
            tool_calls=len(state.tools),
            iterations=state.react_iterations,
            citation_count=len(state.citation_annotations),
        )

        # Log final answer and citations to debug log
        _log_final_answer(state.workflow_id, state.answer, state.citation_annotations)

        

        return state

    def _finish_cannot_answer(self, state: AgentRunState, *, answer: str, reason: str) -> AgentRunState:
        state.answer = answer.strip()
        state.reason = reason
        state.status = AgentStatus.COMPLETED
        state.confidence = "low"
        state.react_complete = True
        state.add_trace("verify_answer", issue_count=len(state.verifier_issues))
        state.add_trace(
            "final",
            action="cannot_answer",
            reason=reason[:500],
            model_calls=state.model_calls,
            tool_calls=len(state.tools),
            iterations=state.react_iterations,
        )

        # Log final failure to debug log
        _log_final_answer(state.workflow_id, state.answer, [])

        return state

    # ── Approval helpers ───────────────────────────────────────────────────

    def _apply_approval_payload(self, state: AgentRunState, payload: Dict[str, Any]) -> None:
        tool_name = str(payload.get("tool") or "").strip()
        if tool_name == "propose_tabular_review":
            proposal = self._tabular_proposal_from_payload(state, payload)
            state.tabular_proposal = proposal
            state.approval_request = self.approvals.tabular_request(workflow_id=state.workflow_id, proposal=proposal)
        else:
            state.approval_request = self.approvals.tool_request(
                workflow_id=state.workflow_id, action=tool_name, payload=payload
            )
        state.status = AgentStatus.WAITING_APPROVAL
        state.reason = "Model selected an approval-gated tool."
        state.answer = str(payload.get("message") or "This action requires human approval before execution.")
        state.add_trace("approval_required", tool=tool_name, reason_summary=state.answer)
        state.add_trace("approval_gate", requires_approval=True)

    def _pending_approval_payload(self, state: AgentRunState) -> Optional[Dict[str, Any]]:
        for tool in state.tools:
            observation = tool.observation
            if _is_approval_payload(observation):
                return observation
        for scratch in state.react_scratchpad:
            observation = scratch.get("observation")
            if _is_approval_payload(observation):
                return observation
        return None

    def _tabular_proposal_from_payload(self, state: AgentRunState, payload: Dict[str, Any]) -> TabularReviewProposal:
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        raw_columns = params.get("columns") if isinstance(params.get("columns"), list) else []
        columns = []
        for index, item in enumerate(raw_columns):
            if isinstance(item, dict):
                name = str(item.get("name") or item.get("title") or f"Column {index + 1}")
                prompt = str(item.get("prompt") or item.get("description") or name)
                fmt = item.get("format")
                tags = item.get("tags") if isinstance(item.get("tags"), list) else []
            else:
                name = str(item or f"Column {index + 1}")
                prompt = name
                fmt = None
                tags = []
            columns.append(TabularColumnProposal(index=index, name=name[:120], prompt=prompt[:2000], format=fmt, tags=tags))
        document_ids = _coerce_string_list(params.get("document_ids")) or state.context.selected_document_ids
        proposal = TabularReviewProposal(
            title=str(params.get("name") or params.get("title") or "ContractSense Review")[:180],
            project_id=str(params.get("project_id") or state.context.project_id or "") or None,
            document_ids=document_ids,
            columns_config=columns,
            reason="Model selected a tabular review approval tool.",
        )
        proposal.estimated_rows = len(proposal.document_ids)
        proposal.estimated_columns = len(proposal.columns_config)
        return proposal

    # ── Citation helpers ───────────────────────────────────────────────────

    def _parse_and_resolve_citations(self, answer: str, state: AgentRunState) -> List[Dict[str, Any]]:
        """Parse and resolve the model's <CITATIONS> block.

        Kept as a thin delegation because callers outside the loop reach for it;
        the implementation is steps 1-2 of services/contract_agent/citations.py.
        """
        return citations.resolve_citations(citations.parse_citation_block(answer), state)

    def _apply_answer_metadata(self, state: AgentRunState) -> None:
        """Set the answer's confidence.

        Citation assembly used to live here too. It now belongs to
        services/contract_agent/citations.py: steps 1-2 run in
        _finish_final_answer and steps 3-5 in middleware.answer_guard, so the
        inline markers are rewritten only after validation has settled the
        numbering.
        """
        confidence_match = re.search(
            r"\*\*Confidence:\*\*\s*(high|medium|low)", state.answer, flags=re.IGNORECASE
        )
        if confidence_match:
            state.confidence = confidence_match.group(1).lower()  # type: ignore[assignment]
        elif state.react_scratchpad:
            state.confidence = "medium"
        elif state.answer:
            state.confidence = "high"

    def _add_token_usage_from_message(self, state: AgentRunState, message: Any) -> None:
        """Accumulate token usage from a model response into state.

        Handles all providers and the additional fields now available via
        stream_usage=True / stream_usage=True:

        • Standard LangChain usage_metadata keys: input_tokens, output_tokens,
          plus cache_read_input_tokens (Claude prompt caching) and
          reasoning_tokens / thinking_tokens (Claude / OpenAI o-series).
        • Fallback: response_metadata.token_usage (OpenAI non-streaming legacy).
        """
        usage: Dict[str, Any] = {}

        # Primary: LangChain normalised usage_metadata (all providers with streaming)
        raw_usage = getattr(message, "usage_metadata", None)
        if isinstance(raw_usage, dict):
            usage = raw_usage

        # Fallback: OpenAI / Groq non-streaming token_usage in response_metadata
        if not usage:
            usage = (getattr(message, "response_metadata", None) or {}).get("token_usage") or {}

        input_tokens = int(
            usage.get("input_tokens")
            or usage.get("prompt_tokens")
            or 0
        )
        output_tokens = int(
            usage.get("output_tokens")
            or usage.get("completion_tokens")
            or 0
        )

        # Additional fields exposed when stream_usage / stream_usage is True
        cache_read_tokens = int(
            usage.get("cache_read_input_tokens")          # Claude prompt cache hits
            or usage.get("input_token_details", {}).get("cache_read")  # nested form
            or 0
        )
        reasoning_tokens = int(
            usage.get("reasoning_tokens")                 # Groq gpt-oss parsed
            or usage.get("thinking_tokens")               # Claude extended thinking
            or (usage.get("output_token_details") or {}).get("reasoning")  # OpenAI o-series
            or 0
        )

        if input_tokens or output_tokens:
            state.token_usage.input_tokens += input_tokens
            state.token_usage.output_tokens += output_tokens
            state.token_usage.total_tokens += input_tokens + output_tokens

        # Store extended fields if the state schema supports them (best-effort)
        if cache_read_tokens and hasattr(state.token_usage, "cache_read_tokens"):
            state.token_usage.cache_read_tokens = (
                getattr(state.token_usage, "cache_read_tokens", 0) + cache_read_tokens
            )
        if reasoning_tokens and hasattr(state.token_usage, "reasoning_tokens"):
            state.token_usage.reasoning_tokens = (
                getattr(state.token_usage, "reasoning_tokens", 0) + reasoning_tokens
            )

    def _record_rejected_tool_call(
        self, state: AgentRunState, *, name: str, args: Dict[str, Any], iteration: int
    ) -> None:
        if any(tool.name == name and tool.status == "rejected" for tool in state.tools):
            return
        record = ToolCallRecord(
            name=name, args=args, status="rejected",
            reason="ToolPolicyMiddleware rejected an unknown or forbidden model-selected tool.",
            iteration=iteration,
            observation={"summary": "Rejected unknown or forbidden tool.", "risk": "forbidden"},
        )
        state.tools.append(record)
        state.react_scratchpad.append({
            "iteration": iteration, "tool": name, "status": record.status, "observation": record.observation,
        })
        state.add_trace("tool_start", iteration=iteration, tool=name, args=args)
        state.add_trace("tool_result", iteration=iteration, tool=name, status="rejected", summary=record.observation["summary"])

    def _model_failure_answer(self, exc: Exception) -> str:
        text = str(exc) or exc.__class__.__name__
        return f"I cannot answer because the agent failed before producing a final response: {text[:300]}"


# ── Reasoning / thinking extraction ───────────────────────────────────────


def _extract_reasoning(message: Any) -> Optional[str]:
    """Extract internal reasoning / thinking text from a model response.

    Handles all providers:

    • Claude extended thinking (Claude 3.7 / 4.x with thinking enabled):
      response.content is a list of blocks. Thinking blocks have the shape
      {"type": "thinking", "thinking": "<text>"}.  We concatenate all of them.

    • Groq gpt-oss (reasoning_format="parsed"):
      Exposed as a top-level ``reasoning_content`` string attribute.

    • OpenAI o-series:
      Reasoning tokens are consumed internally and NOT exposed in the message
      content — nothing to extract here.

    Returns None if no reasoning content is found.
    """
    # 1. Groq parsed reasoning (top-level attribute)
    groq_reasoning = getattr(message, "reasoning_content", None)
    if groq_reasoning and isinstance(groq_reasoning, str):
        return groq_reasoning.strip() or None

    # 2. Claude thinking blocks (content is a list of typed dicts)
    content = getattr(message, "content", None)
    if isinstance(content, list):
        thinking_parts: List[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type", "")
            if block_type == "thinking":
                # Claude 3.7 / Claude 4 extended thinking
                text = block.get("thinking") or block.get("text") or ""
                if text:
                    thinking_parts.append(str(text))
            elif block_type == "redacted_thinking":
                # Claude may redact some thinking blocks; surface a placeholder
                thinking_parts.append("<thinking redacted>")
        if thinking_parts:
            return "\n\n".join(thinking_parts)

    return None


# ── Text helpers ───────────────────────────────────────────────────────────


def _stringify_content(content: Any) -> str:
    """Convert a message content value to a plain string.

    When content is a list of typed blocks (Claude extended thinking, tool use,
    etc.) only ``text`` blocks are included.  Thinking / redacted_thinking /
    tool_use / tool_result blocks are deliberately excluded so they don't
    pollute the final answer text.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict):
                # Only include plain text blocks; skip thinking/tool blocks
                block_type = item.get("type", "text")
                if block_type == "text":
                    parts.append(str(item.get("text") or item.get("content") or ""))
                # Explicitly skip: thinking, redacted_thinking, tool_use, tool_result
            else:
                parts.append(str(item))
        return "\n".join(part for part in parts if part)
    return str(content or "")


def _message_text(value: Any) -> str:
    if isinstance(value, BaseMessage):
        return _stringify_content(value.content)
    if isinstance(value, dict) and "content" in value:
        return _stringify_content(value.get("content"))
    return _stringify_content(value)


def _has_rejected_forbidden_tool(state: AgentRunState) -> bool:
    for tool in state.tools:
        if tool.status != "rejected":
            continue
        name = str(tool.name or "")
        if name in FORBIDDEN_TOOL_NAMES or name.startswith("send_"):
            return True
        observation = tool.observation if isinstance(tool.observation, dict) else {}
        if observation.get("risk") == "forbidden":
            return True
    return False


def _has_evidence_content(tool_messages: List[ToolMessage]) -> bool:
    """Check whether any ToolMessage contains real search evidence (not empty / no-results)."""
    for msg in tool_messages:
        content = str(msg.content)
        if content and not content.startswith("No contract sections matched"):
            if "Evidence ID:" in content or content.strip().startswith("[1]"):
                return True
    return False


def _answer_preflight_issues(state: AgentRunState, answer: str) -> list[str]:
    issues: list[str] = []
    if not answer.strip():
        return ["empty_final_answer"]

    if _has_observed_contract_evidence(state) and not _is_unsupported_or_refusal(answer):
        if not state.citation_annotations:
            issues.append("missing_citation")
        if not re.search(r"\[\d+\]", answer):
            issues.append("missing_inline_citation")

    if _mentions_completed_side_effect(answer) and not state.approval_request:
        issues.append("approval_or_side_effect_claim_without_observed_approval")

    return list(dict.fromkeys(issues))


def _has_observed_contract_evidence(state: AgentRunState) -> bool:
    for scratch in state.react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        if isinstance(observation.get("matches"), list) and observation["matches"]:
            return True
        for key in ("search_results", "snippet", "quote", "context"):
            if str(observation.get(key) or "").strip():
                return True
    return False


def _is_unsupported_or_refusal(answer: str) -> bool:
    normalized = " ".join((answer or "").lower().split())
    return any(phrase in normalized for phrase in (
        "does not contain",
        "did not find",
        "not found",
        "no evidence",
        "insufficient evidence",
        "cannot answer",
        "can't answer",
        "cannot perform",
        "can't perform",
        "i cannot help",
        "i can't help",
        "requires human approval",
        "requires approval",
    ))


def _mentions_completed_side_effect(answer: str) -> bool:
    normalized = " ".join((answer or "").lower().split())
    action_terms = (
        "created", "drafted", "sent", "emailed", "exported", "generated",
        "edited", "modified", "redlined", "replicated", "applied",
    )
    object_terms = (
        "draft", "artifact", "email", "notice", "docx", "document", "copy",
        "redline", "tabular review", "table", "source contract",
    )
    return any(term in normalized for term in action_terms) and any(term in normalized for term in object_terms)


def _observation_context(state: AgentRunState) -> str:
    lines: list[str] = []
    for scratch in state.react_scratchpad[-8:]:
        tool = str(scratch.get("tool") or "tool")
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            text = str(observation or "").strip()
            if text:
                lines.append(f"- {tool}: {text[:800]}")
            continue
        summary = str(observation.get("summary") or "").strip()
        if summary:
            lines.append(f"- {tool}: {summary[:500]}")
        search_results = observation.get("search_results")
        if isinstance(search_results, str) and search_results.strip():
            lines.append(search_results.strip()[:3000])
        matches = observation.get("matches")
        if isinstance(matches, list):
            for item in matches[:5]:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("context") or item.get("quote") or item.get("snippet") or "").strip()
                if not text:
                    continue
                source = item.get("filename") or item.get("document_id") or item.get("doc_id") or "Scoped document"
                page = item.get("page")
                location = f"{source}" + (f", p.{page}" if page else "")
                # No internal id here either — this text can end up quoted back
                # by the model in an answer, same as the fallback formatter below.
                lines.append(f"  - {location}: {text[:1500]}")
        elif observation.get("snippet"):
            source = observation.get("filename") or observation.get("document_id") or "Scoped document"
            page = observation.get("page")
            location = f"{source}" + (f", p.{page}" if page else "")
            lines.append(f"  - {location}: {str(observation.get('snippet'))[:900]}")
    return "\n".join(lines[-40:])


def _answer_from_observations(state: AgentRunState) -> str:
    annotations = citations.citations_from_observations(state)
    if annotations:
        first = annotations[0]
        quote = str(first.get("quote") or "").strip()
        if quote:
            source = first.get("filename") or first.get("document_id") or first.get("doc_id") or "scoped evidence"
            page = first.get("page")
            location = str(source)
            if page:
                location = f"{location}, p.{page}"
            # segment_id is an internal chunk identifier (e.g. "macro_0_2fd71...")
            # with no meaning to a reader — it must never reach this string, only
            # the structured citation payload that carries it for the UI's own use.
            return f"{quote}\n\nSource: {location}\n\n**Confidence:** medium"
    observation_context = _observation_context(state).strip()
    if observation_context:
        return f"Based on the scoped tool observations:\n{observation_context}\n\n**Confidence:** medium"
    return ""


def _coerce_string_list(value: Any) -> list[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)] if str(value).strip() else []


def _is_approval_payload(value: Any) -> bool:
    """Recognize both current and legacy approval observations.

    The explicit status is the model-facing contract; the private flag keeps
    pending approvals discoverable for checkpoints written before this change.
    """
    return (
        isinstance(value, dict)
        and (
            value.get("status") == "approval_required"
            or bool(value.get("__APPROVAL_REQUIRED__"))
        )
    )


def _trace_bodies_enabled() -> bool:
    """Prompt and response bodies contain retrieved contract text.

    They are only emitted when explicitly opted into, and must stay off in every
    deployed environment.
    """
    return os.environ.get("AGENT_TRACE_BODIES", "").strip() == "1"


def _content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value in (None, "", [], {}):
        return ""
    return json.dumps(value, default=str)


def _render_message_stack(messages: Sequence[BaseMessage]) -> str:
    parts: List[str] = []
    for idx, message in enumerate(messages, start=1):
        content = _content_text(getattr(message, "content", ""))
        tool_calls = getattr(message, "tool_calls", None)
        if tool_calls:
            content += f"\nTool Calls: {json.dumps(tool_calls, default=str, indent=2)}"
        parts.append(f"\n--- Message {idx} ({message.__class__.__name__}) ---\n{content}\n")
    return "".join(parts)


def _log_agent_turn(
    workflow_id: str,
    iteration: int,
    messages: Sequence[BaseMessage],
    *,
    response_text: str = "",
    tool_names: Sequence[Any] = (),
    response_metadata: Optional[Dict[str, Any]] = None,
    label: str = "turn",
) -> None:
    """Metadata-only DEBUG record for one model turn."""
    if not logger.isEnabledFor(logging.DEBUG):
        return
    logger.debug(
        "agent %s workflow=%s iteration=%s messages=%d prompt_chars=%d response_chars=%d tools=%s usage=%s",
        label,
        workflow_id,
        iteration,
        len(messages),
        sum(len(_content_text(getattr(m, "content", ""))) for m in messages),
        len(response_text or ""),
        list(tool_names),
        (response_metadata or {}).get("token_usage") or (response_metadata or {}).get("usage"),
    )
    if _trace_bodies_enabled():
        logger.debug(
            "agent %s bodies workflow=%s iteration=%s\n--- PROMPT ---\n%s\n--- RESPONSE ---\n%s",
            label,
            workflow_id,
            iteration,
            _render_message_stack(messages),
            response_text,
        )


def _log_final_answer(workflow_id: str, answer: str, citations: Sequence[Any]) -> None:
    if not logger.isEnabledFor(logging.DEBUG):
        return
    citation_list = list(citations or [])
    logger.debug(
        "agent final workflow=%s answer_chars=%d citations=%d",
        workflow_id,
        len(answer or ""),
        len(citation_list),
    )
    if _trace_bodies_enabled():
        logger.debug(
            "agent final bodies workflow=%s\n--- ANSWER ---\n%s\n--- CITATIONS ---\n%s",
            workflow_id,
            answer,
            json.dumps(citation_list, default=str, indent=2),
        )
