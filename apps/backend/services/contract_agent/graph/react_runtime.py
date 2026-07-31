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
import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    SystemMessage,
    AIMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool

from core.config import settings

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
from .tools.langchain_tools import build_langchain_tools
from .tools.registry import FORBIDDEN_TOOL_NAMES


ToolExecutor = Callable[[ToolCallRecord, AgentRunState], Dict[str, Any]]

DEFAULT_MAX_ITERATIONS = 8



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

    # ── Public entry point ─────────────────────────────────────────────────

    def run(
        self,
        state: AgentRunState,
        *,
        checkpoint_config: Optional[Dict[str, Any]] = None,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> AgentRunState:
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
                state, model=model, tools=tools, system_prompt=system_prompt, on_event=on_event
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

        for iteration in range(1, self.max_iterations + 1):
            if on_event:
                on_event("status", {"message": f"Thinking (step {iteration})", "iteration": iteration})

            # Format the messages (prompts and chunks) for debugging
            prompt_str = ""
            for idx, msg in enumerate(messages):
                role = msg.__class__.__name__
                content = getattr(msg, "content", "")
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    content += f"\nTool Calls: {json.dumps(msg.tool_calls, default=str, indent=2)}"
                prompt_str += f"\n--- Message {idx + 1} ({role}) ---\n{content}\n"

            state.add_trace(
                "prompt_sent",
                iteration=iteration,
                system_prompt_summary=system_prompt[:200] + "..." if len(system_prompt) > 200 else system_prompt,
                user_message_snippet=user_message[:300],
                messages_count=len(messages),
            )

            response = self._invoke_tool_call(tool_model, messages, state)
            state.react_iterations = max(state.react_iterations, iteration)

            # Format the raw response for debugging
            raw_response_str = f"Content: {response.content}\n"
            if hasattr(response, "tool_calls") and response.tool_calls:
                raw_response_str += f"Tool Calls: {json.dumps(response.tool_calls, default=str, indent=2)}\n"
            if hasattr(response, "response_metadata") and response.response_metadata:
                raw_response_str += f"Response Metadata: {json.dumps(response.response_metadata, default=str, indent=2)}\n"

            _append_agent_debug_log(state.workflow_id, iteration, prompt_str, raw_response_str)

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

                # Synthesis turn: after tools return evidence chunks, feed them
                # back to the same agent (without tools bound) so it produces a
                # properly cited answer from the evidence, rather than answering
                # inline in the same turn it calls tools.
                if (
                    tool_messages
                    and _has_evidence_content(tool_messages)
                    and iteration < self.max_iterations
                ):
                    state.add_trace(
                        "synthesis_turn", iteration=iteration,
                        action="synthesize_evidence",
                        reason_summary="Evidence retrieved; feeding chunks back to agent for cited answer.",
                    )
                    synthesis_prompt = (
                        f"Original query: {state.message}\n\n"
                        f"Using only the evidence returned by the tools above, "
                        f"produce a properly cited answer to the query. "
                        f"Use inline citation markers like [1], [2] for each fact you reference, "
                        f"and include a structured <CITATIONS> JSON block at the end "
                        f"with the exact ref, doc_id, page or the page range, and quote for each citation."
                    )
                    messages.append(HumanMessage(content=synthesis_prompt))

                    # Log synthesis prompt for debugging
                    synth_iteration = iteration + 1
                    synth_prompt_str = ""
                    for idx, msg in enumerate(messages):
                        role = msg.__class__.__name__
                        content = getattr(msg, "content", "")
                        if hasattr(msg, "tool_calls") and msg.tool_calls:
                            content += f"\nTool Calls: {json.dumps(msg.tool_calls, default=str, indent=2)}"
                        synth_prompt_str += f"\n--- Message {idx + 1} ({role}) ---\n{content}\n"

                    if on_event:
                        on_event("status", {"message": "Writing answer…", "iteration": synth_iteration})
                    provider = str(state.ai_provider or getattr(settings, "ai_provider", None) or "groq").lower()
                    synthesis_model = tool_model if "groq" in provider else model
                    answer = self._stream_text_response(synthesis_model, messages, state, on_event, synth_iteration)
                    _append_agent_debug_log(state.workflow_id, synth_iteration, synth_prompt_str, answer)
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
                if on_event:
                    on_event("delta", {"text": answer, "iteration": iteration})
                state.add_trace(
                    "model_step",
                    iteration=iteration,
                    action="final_answer",
                    reason_summary="Model produced the final answer.",
                )
                return self._finish_answer(state, answer=answer, reason="Tool-calling agent produced the final answer.")

        # Step limit reached — synthesize from whatever was observed
        answer = _answer_from_observations(state)
        if answer:
            return self._finish_answer(
                state,
                answer=answer,
                reason="Agent reached step limit; answer synthesized from observed evidence.",
            )
        return self._finish_cannot_answer(
            state,
            answer="I could not produce a final answer from the available scoped evidence.",
            reason="Tool-calling loop ended without a final answer.",
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
            "Use the available tools to gather evidence, then provide a cited final answer."
        )

    def _invoke_tool_call(self, tool_model: Any, messages: list, state: "AgentRunState") -> Any:
        response = tool_model.invoke(messages)
        self._add_token_usage_from_message(state, response)
        return response

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
            )

            if on_event:
                on_event("tool_call", {"name": name, "args": args, "iteration": iteration})

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
                        status = last.status
                        if isinstance(obs, dict):
                            summary = str(obs.get("summary") or "Done.")
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
                self._apply_approval_payload(state, exc.payload)
                if on_event:
                    on_event("tool_result", {
                        "name": name,
                        "summary": "Approval required.",
                        "status": "planned",
                        "iteration": iteration,
                    })
                raise  # bubble up to run() which handles WAITING_APPROVAL

            except Exception as exc:
                error_text = str(exc)[:500]
                state.add_trace("tool_result", iteration=iteration, tool=name, status="error", summary=error_text)
                if on_event:
                    on_event("tool_result", {
                        "name": name,
                        "summary": error_text,
                        "status": "error",
                        "iteration": iteration,
                    })
                tool_messages.append(
                    ToolMessage(
                        content=f"Tool execution error: {error_text}",
                        tool_call_id=call_id,
                    )
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
        # Unify double-byte bracket citation markers
        if answer:
            answer = re.sub(
                r"【(\d+(?:\s*,\s*\d+)*)(?:†[^】\n]*)?】",
                lambda m: f"[{m.group(1)}]",
                answer,
            )
        # Try parsing model-generated citations first if not already parsed
        if not state.citation_annotations:
            model_citations = self._parse_and_resolve_citations(answer, state)
            if model_citations:
                # Strip the <CITATIONS> block from the answer prose FIRST so we can
                # scan for inline markers on the clean text.
                clean_answer = re.sub(r"<CITATIONS>[\s\S]*?(?:</CITATIONS>|$)", "", answer, flags=re.IGNORECASE).strip()
                # --- Bug fix 1: Drop citations whose [N] marker is never used inline ---
                # Collect every numeric ref that actually appears in the prose.
                used_refs = {int(m) for m in re.findall(r"\[(\d+)\]", clean_answer)}
                if used_refs:
                    model_citations = [c for c in model_citations if c.get("ref") in used_refs]
                answer = clean_answer
                state.citation_annotations = model_citations

            # --- Fallback: model used 【N】 markers but no <CITATIONS> block ---
            # Build precise citations from tool observations matching the cited refs,
            # instead of falling through to _annotations_from_observations which
            # pulls in ALL evidence indiscriminately.
            if not state.citation_annotations:
                clean_answer = re.sub(r"<CITATIONS>[\s\S]*?(?:</CITATIONS>|$)", "", answer, flags=re.IGNORECASE).strip()
                cited_refs = {int(m) for m in re.findall(r"\[(\d+)\]", clean_answer)}
                if cited_refs:
                    answer = clean_answer
                    fallback_citations = _build_citations_from_tool_observations(state, cited_refs)
                    if fallback_citations:
                        state.citation_annotations = fallback_citations

        state.answer = answer.strip()
        state.reason = reason
        state.status = AgentStatus.COMPLETED
        state.react_complete = True
        self._apply_answer_metadata(state)
        state.add_trace("verify_answer", issue_count=len(state.verifier_issues))
        state.add_trace("final", action="final_answer", confidence=state.confidence)

        # Log final answer and citations to debug log
        _log_final_answer_debug(state.workflow_id, state.answer, state.citation_annotations)

        

        return state

    def _finish_cannot_answer(self, state: AgentRunState, *, answer: str, reason: str) -> AgentRunState:
        state.answer = answer.strip()
        state.reason = reason
        state.status = AgentStatus.COMPLETED
        state.confidence = "low"
        state.react_complete = True
        state.add_trace("verify_answer", issue_count=len(state.verifier_issues))
        state.add_trace("final", action="cannot_answer", reason=reason[:500])

        # Log final failure to debug log
        _log_final_answer_debug(state.workflow_id, state.answer, [])

        return state

    # ── Approval helpers ───────────────────────────────────────────────────

    def _apply_approval_payload(self, state: AgentRunState, payload: Dict[str, Any]) -> None:
        tool_name = str(payload.get("tool") or "").strip()
        if tool_name in ("create_tabular_review", "suggest_tabular_review"):
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
            if isinstance(observation, dict) and observation.get("__APPROVAL_REQUIRED__"):
                return observation
        for scratch in state.react_scratchpad:
            observation = scratch.get("observation")
            if isinstance(observation, dict) and observation.get("__APPROVAL_REQUIRED__"):
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
        match = re.search(r"<CITATIONS?>\s*([\s\S]*?)\s*(?:</CITATIONS?>|$)", answer, re.IGNORECASE)
        if not match:
            return []
        raw_content = match.group(1).strip()
        try:
            if raw_content.startswith("```"):
                lines = raw_content.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                raw_content = "\n".join(lines).strip()
            
            raw_citations = []
            try:
                raw_citations = json.loads(raw_content)
                if not isinstance(raw_citations, list):
                    raw_citations = []
            except Exception:
                # Fallback: Find individual JSON objects { ... } using regex
                matches = re.finditer(r"\{[\s\S]*?\}", raw_content)
                for m in matches:
                    try:
                        obj = json.loads(m.group(0))
                        if isinstance(obj, dict):
                            raw_citations.append(obj)
                    except Exception:
                        continue
            if not raw_citations:
                return []
        except Exception:
            return []

        resolved = []
        doc_index: Dict[str, Any] = {}
        attached = state.context.attached_documents or []

        for i, doc in enumerate(attached):
            doc_label = f"doc-{i}"
            doc_id = doc.get("document_id") or doc.get("id") or ""
            filename = doc.get("filename") or doc.get("name") or doc_label
            doc_info = {
                "document_id": doc_id,
                "filename": filename,
                "version_id": doc.get("version_id"),
                "version_number": doc.get("version_number"),
            }
            doc_index[doc_label] = doc_info
            if doc_id:
                doc_index[str(doc_id)] = doc_info
            if filename:
                doc_index[filename] = doc_info

        selected_ids = state.context.selected_document_ids or []
        for i, doc_id in enumerate(selected_ids):
            doc_label = f"doc-{i}"
            if doc_label not in doc_index:
                filename = doc_label
                for t in state.tools:
                    obs = t.observation
                    if isinstance(obs, dict):
                        for m in (obs.get("matches") or []):
                            if isinstance(m, dict) and (m.get("document_id") == doc_id or m.get("doc_id") == doc_id):
                                filename = m.get("filename") or filename
                                break
                doc_info = {"document_id": doc_id, "filename": filename, "version_id": None, "version_number": None}
                doc_index[doc_label] = doc_info
                doc_index[doc_id] = doc_info

        for item in raw_citations:
            if not isinstance(item, dict):
                continue
            try:
                ref_val = int(item.get("ref", 0))
            except (ValueError, TypeError):
                continue
            if ref_val <= 0:
                continue
            raw_doc_id = str(item.get("doc_id") or "").strip()
            quote = str(item.get("quote") or "").strip()
            raw_page = item.get("page")
            page, page_start, page_end = _parse_page_range(raw_page)
            doc_info = doc_index.get(raw_doc_id)
            if not doc_info:
                for key, val in doc_index.items():
                    if key.lower() == raw_doc_id.lower():
                        doc_info = val
                        break
            doc_id_resolved = doc_info["document_id"] if (doc_info and doc_info["document_id"]) else raw_doc_id
            filename_resolved = doc_info["filename"] if (doc_info and doc_info["filename"]) else raw_doc_id
            resolved.append({
                "type": "citation_data",
                "ref": ref_val,
                "doc_id": doc_id_resolved,
                "document_id": doc_id_resolved,
                "version_id": doc_info.get("version_id") if doc_info else None,
                "version_number": doc_info.get("version_number") if doc_info else None,
                "filename": filename_resolved,
                "page": page,
                "page_start": page_start,
                "page_end": page_end,
                "quote": quote,
                "text": quote,
                "preview": quote,
            })
        return resolved

    # ── Metadata / token helpers ───────────────────────────────────────────

    def _apply_answer_metadata(self, state: AgentRunState) -> None:
        confidence_match = re.search(r"\*\*Confidence:\*\*\s*(high|medium|low)", state.answer, flags=re.IGNORECASE)
        if confidence_match:
            state.confidence = confidence_match.group(1).lower()  # type: ignore[assignment]
        elif state.react_scratchpad:
            state.confidence = "medium"
        elif state.answer:
            state.confidence = "high"

        if state.citation_annotations:
            annotations = state.citation_annotations
            annotations = _enrich_citations_from_observations(annotations, state)
            state.citation_annotations = annotations
            state.answer = _normalize_answer_citation_markers(state.answer, annotations, state.react_scratchpad)
            # --- Drop annotations whose [N] marker is not used inline in the answer ---
            # The model may have included an annotation in the CITATIONS block or my
            # fallback may have built it, but if the marker never appears in the prose
            # it should not be surfaced to the frontend.
            used_refs_in_answer = {int(m) for m in re.findall(r"\[(\d+)\]", state.answer)}
            if used_refs_in_answer:
                annotations = [a for a in annotations if a.get("ref") in used_refs_in_answer]
            state.citation_annotations = annotations
            state.citation_details = {
                "annotations": annotations,
                "cited_segments": [
                    {
                        "id": item.get("segment_id") or f"model-citation-{index}",
                        "text": item.get("quote", ""),
                        "quote": item.get("quote", ""),
                        "preview": item.get("quote", ""),
                        "page": item.get("page"),
                        "page_number": item.get("page"),
                        "page_start": item.get("page_start") or item.get("page"),
                        "page_end": item.get("page_end"),
                        "contract_id": item.get("doc_id"),
                        "contract_name": item.get("filename"),
                        "type": "model_citation",
                        "verified": item.get("verified", True),
                    }
                    for index, item in enumerate(annotations, start=1)
                ],
                "citation_style": "model_citations",
            }
        else:
            annotations = _annotations_from_observations(state)
            if annotations:
                state.answer = _normalize_answer_citation_markers(state.answer, annotations, state.react_scratchpad)
                # --- Bug fix (fallback path): drop annotations whose [N] marker
                # is not actually used inline in the answer prose.
                # The model may have cited only [1] but the search returned 3+
                # unique segments — we must not surface the uncited ones.
                used_refs_in_answer = {int(m) for m in re.findall(r"\[(\d+)\]", state.answer)}
                if used_refs_in_answer:
                    annotations = [a for a in annotations if a.get("ref") in used_refs_in_answer]
                state.citation_annotations = annotations
                state.citation_details = {
                    "annotations": annotations,
                    "cited_segments": [
                        {
                            "id": item.get("segment_id") or f"tool-observation-{index}",
                            "text": item.get("quote", ""),
                            "quote": item.get("quote", ""),
                            "preview": item.get("quote", ""),
                            "page": item.get("page"),
                            "page_number": item.get("page"),
                            "page_start": item.get("page_start") or item.get("page"),
                            "page_end": item.get("page_end"),
                            "contract_id": item.get("doc_id"),
                            "contract_name": item.get("filename"),
                            "type": "tool_observation",
                            "verified": item.get("verified", True),
                        }
                        for index, item in enumerate(annotations, start=1)
                    ],
                    "citation_style": "react_tool_observation",
                }
        if state.citation_annotations:
            state.answer = _ensure_inline_citation_marker(state.answer, state.citation_annotations)

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
                evidence_id = item.get("evidence_id") or item.get("segment_id")
                location = f"{source}" + (f", p.{page}" if page else "")
                suffix = f" [{evidence_id}]" if evidence_id else ""
                lines.append(f"  - {location}{suffix}: {text[:1500]}")
        elif observation.get("snippet"):
            source = observation.get("filename") or observation.get("document_id") or "Scoped document"
            page = observation.get("page")
            location = f"{source}" + (f", p.{page}" if page else "")
            lines.append(f"  - {location}: {str(observation.get('snippet'))[:900]}")
    return "\n".join(lines[-40:])


def _normalize_answer_citation_markers(answer: str, annotations: list[Dict[str, Any]], react_scratchpad: list[Dict[str, Any]]) -> str:
    if not answer or not annotations:
        return answer

    # 1. Build mappings
    # Map segment_id / evidence_id / id to display ref
    marker_to_ref: dict[str, str] = {}
    # Map original tool observation index (matches list) to display ref
    tool_idx_to_display_ref: dict[int, str] = {}
    # Map original citation ref in the LLM CITATIONS block to display ref
    citation_ref_to_display_ref: dict[int, str] = {}

    from services.contract_agent.graph.middleware import (
        _normalize_citation_text,
        _citation_tokens,
    )

    for annotation in annotations:
        ref = annotation.get("ref")
        if not ref:
            continue
        ref_text = str(ref)

        # Populate original citation ref mapping
        try:
            own_ref = int(ref)
            if own_ref > 0:
                citation_ref_to_display_ref[own_ref] = ref_text
        except (ValueError, TypeError):
            pass

        # Populate tool observation index mapping from explicit source_ref field
        source_ref = annotation.get("source_ref")
        if source_ref:
            try:
                tool_idx_to_display_ref[int(source_ref)] = ref_text
            except (ValueError, TypeError):
                pass

        # Match by evidence_id/segment_id or quote text overlap to find corresponding tool match index
        ann_evidence_id = str(annotation.get("evidence_id") or annotation.get("segment_id") or "").strip()
        cit_quote = _normalize_citation_text(annotation.get("quote") or "")
        quote_tokens = set(_citation_tokens(cit_quote)) if cit_quote else set()

        for scratch in react_scratchpad:
            observation = scratch.get("observation")
            if not isinstance(observation, dict):
                continue
            matches = observation.get("matches") or []
            if not isinstance(matches, list):
                continue
            for idx, match in enumerate(matches, start=1):
                if not isinstance(match, dict):
                    continue

                # Primary: match by evidence_id / segment_id — immune to index drift
                if ann_evidence_id:
                    match_eid = str(match.get("evidence_id") or match.get("segment_id") or "").strip()
                    if match_eid and match_eid == ann_evidence_id:
                        tool_idx_to_display_ref[idx] = ref_text
                        break

                # Secondary: token-overlap or substring match on quote text
                if not cit_quote:
                    continue
                for key in ("context", "quote", "snippet", "text"):
                    obs_text = _normalize_citation_text(str(match.get(key) or ""))
                    if not obs_text:
                        continue
                    supported = False
                    if quote_tokens:
                        obs_tokens = set(_citation_tokens(obs_text))
                        if obs_tokens:
                            overlap = quote_tokens & obs_tokens
                            overlap_ratio = len(overlap) / len(quote_tokens)
                            if overlap_ratio >= 0.40:
                                supported = True
                    if not supported and (cit_quote in obs_text or obs_text in cit_quote):
                        supported = True

                    if supported:
                        tool_idx_to_display_ref[idx] = ref_text
                        break

        # Populate segment_id mapping
        for key in ("segment_id", "evidence_id", "source_id", "id"):
            value = annotation.get(key)
            if value:
                marker_to_ref[str(value).strip()] = ref_text

    # 2. Normalize document-prefixed markers: [doc-0 #3], [doc-0 p.3], [doc-0: 3], [doc-0, #3], etc.
    doc_marker_pattern = r"\[doc-\d+(?:\s*,\s*|\s*:\s*|\s+)(?:#|p\.|page\s*)?(\d+)\]"
    def replace_doc_marker(match: re.Match[str]) -> str:
        try:
            val = int(match.group(1))
            display_ref = tool_idx_to_display_ref.get(val)
            if display_ref:
                return f"[{display_ref}]"
        except (ValueError, TypeError):
            pass
        return match.group(0)
    answer = re.sub(doc_marker_pattern, replace_doc_marker, answer)

    # 3. Normalize numeric markers: [5] -> [4] if renumbered
    def replace_numeric_marker(match: re.Match[str]) -> str:
        try:
            val = int(match.group(1))
            display_ref = citation_ref_to_display_ref.get(val)
            if display_ref:
                return f"[{display_ref}]"
        except (ValueError, TypeError):
            pass
        return match.group(0)
    answer = re.sub(r"\[(\d+)\]", replace_numeric_marker, answer)

    # 4. Normalize segment ID/UUID markers: [segment_id] -> [ref]
    if marker_to_ref:
        def replace_uuid_marker(match: re.Match[str]) -> str:
            marker = match.group(1).strip()
            ref = marker_to_ref.get(marker)
            return f"[{ref}]" if ref else match.group(0)
        answer = re.sub(r"\[([A-Za-z0-9:_\-]{8,})\]", replace_uuid_marker, answer)

    return answer


def _ensure_inline_citation_marker(answer: str, annotations: list[Dict[str, Any]]) -> str:
    if not answer or not annotations or re.search(r"\[\d+\]", answer):
        return answer
    if _is_unsupported_or_refusal(answer):
        return answer

    refs = [
        int(item.get("ref"))
        for item in annotations
        if str(item.get("ref") or "").isdigit()
    ]
    if not refs:
        return answer
    marker = f"[{min(refs)}]"

    lines = answer.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(("#", "-", "*", "<", "|")):
            continue
        if stripped.lower().startswith("**confidence"):
            continue
        lines[index] = line.rstrip() + f" {marker}"
        return "\n".join(lines)
    return answer.rstrip() + f" {marker}"


def _parse_page_range(
    raw_page: Any,
) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """Parse a raw page value (int, str number, or range like "1-3") into (page, page_start, page_end).

    Handles all common dash variants: hyphen (-), en-dash (–), em-dash (—),
    non-breaking hyphen (‑), and figure dash (‒).
    Returns (first_page, page_start, page_end).  When raw_page is a single page,
    page_start == page_end == first_page.  When it's a range, page_start is the
    first page and page_end is the last page.
    """
    if raw_page is None:
        return None, None, None

    # Integer already
    if isinstance(raw_page, int):
        return raw_page, raw_page, raw_page

    # Non-string numeric
    if not isinstance(raw_page, str):
        try:
            v = int(raw_page)
            return v, v, v
        except (ValueError, TypeError):
            return None, None, None

    raw_str = raw_page.strip()
    if not raw_str:
        return None, None, None

    # Normalise all dash variants to plain hyphen for splitting
    normalised = re.sub(r"[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]", "-", raw_str)

    # Check for page range pattern: digits - digits (optional whitespace around dash)
    range_match = re.fullmatch(r"(\d+)\s*-\s*(\d+)", normalised)
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        if end < start:
            end = start
        return start, start, end

    # Single number or "Page N" style
    single_match = re.search(r"\d+", raw_str)
    if single_match:
        v = int(single_match.group(0))
        return v, v, v

    return None, None, None


def _extract_page_from_text_markers(full_text: str, quote: str) -> Optional[int]:
    """Search for the last page marker preceding the quote in full_text."""
    if not full_text or not quote:
        return None

    # Find the position of the quote in the full text (case-insensitive and normalized-space)
    norm_full = re.sub(r"\s+", " ", full_text).lower()
    norm_quote = re.sub(r"\s+", " ", quote).lower()

    pos = norm_full.find(norm_quote)
    if pos == -1:
        # Try a substring of the quote if the full quote is slightly off
        norm_quote_short = norm_quote[:100]
        pos = norm_full.find(norm_quote_short)

    if pos == -1:
        # Try finding the first few words of the quote
        words = norm_quote.split()
        if len(words) > 5:
            words_short = " ".join(words[:5])
            pos = norm_full.find(words_short)

    if pos == -1:
        return None

    prefix = norm_full[:pos]

    # Find page markers in the prefix: e.g. "--- page 6 ---"
    markers = list(re.finditer(r"-\s*-\s*-\s*page\s*(\d+)\s*-\s*-\s*-", prefix))
    if not markers:
        # Try matching "[page 6]" or "page 6"
        markers = list(re.finditer(r"(?:page\s*|\[\s*page\s*)(\d+)", prefix))

    if markers:
        return int(markers[-1].group(1))

    return None


def _enrich_citations_from_observations(annotations: list[Dict[str, Any]], state: AgentRunState) -> list[Dict[str, Any]]:
    if not annotations:
        return annotations

    from services.contract_agent.graph.middleware import (
        _normalize_citation_text,
        _citation_tokens,
    )

    # Collect all page/quote data from tool observations
    obs_entries: list[Dict[str, Any]] = []
    for scratch in state.react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        candidates: list[Dict[str, Any]] = []
        if isinstance(observation.get("matches"), list):
            candidates.extend(item for item in observation["matches"] if isinstance(item, dict))
        if observation.get("snippet"):
            candidates.append(observation)
        for candidate in candidates:
            # Use fuller context/text if available to run page estimation
            text = str(candidate.get("context") or candidate.get("snippet") or candidate.get("quote") or "").strip()
            if not text:
                continue
            obs_entries.append({
                "doc_id": str(candidate.get("document_id") or candidate.get("doc_id") or ""),
                "filename": candidate.get("filename"),
                "page": candidate.get("page"),
                "page_start": candidate.get("page_start") or candidate.get("page_number"),
                "page_end": candidate.get("page_end"),
                "quote": text,
            })

    if not obs_entries:
        return annotations

    # Build lookup by doc_id
    doc_entries: dict[str, list[Dict[str, Any]]] = {}
    for entry in obs_entries:
        doc_id = entry["doc_id"]
        if doc_id:
            doc_entries.setdefault(doc_id, []).append(entry)

    for item in annotations:
        cit_quote = str(item.get("quote") or "").strip()
        doc_id = str(item.get("doc_id") or item.get("document_id") or "")
        
        # Try to find a matching observation chunk if quote is present
        matched = None
        if cit_quote:
            norm_cit_quote = _normalize_citation_text(cit_quote)
            cit_tokens = set(_citation_tokens(norm_cit_quote))
            best_overlap = 0.0
            
            # Filter observations for this doc_id
            doc_obs = doc_entries.get(doc_id, [])
            if not doc_obs and doc_id:
                # Try to fall back to matches where doc_id matches partially or is empty
                doc_obs = [entry for entry in obs_entries if entry["doc_id"] == doc_id or not entry["doc_id"]]
            if not doc_obs:
                doc_obs = obs_entries

            # 1. Substring matches first (precise)
            for entry in doc_obs:
                norm_obs_quote = _normalize_citation_text(entry["quote"])
                if norm_cit_quote in norm_obs_quote or norm_obs_quote in norm_cit_quote:
                    matched = entry
                    break

            # 2. Token overlap matches if no substring match found
            if not matched and cit_tokens:
                for entry in doc_obs:
                    norm_obs_quote = _normalize_citation_text(entry["quote"])
                    obs_tokens = set(_citation_tokens(norm_obs_quote))
                    if obs_tokens:
                        overlap = cit_tokens & obs_tokens
                        ratio = len(overlap) / len(cit_tokens)
                        if ratio >= 0.40 and ratio > best_overlap:
                            best_overlap = ratio
                            matched = entry

        # If we matched an observation chunk, enrich the page and filename
        if matched:
            page_start = matched.get("page_start")
            page_end = matched.get("page_end")
            
            # If the chunk spans multiple pages, interpolate using the quote position.
            # Only estimate when the annotation lacks a page — the search result's own
            # `page` field is more reliable than linear interpolation (which can be off
            # when the chunk's text doesn't distribute evenly across pages).
            if page_start and page_end and page_end > page_start and item.get("page") is None:
                from services.contract_agent.graph.tools.executor import _estimate_page_for_quote
                item["page"] = _estimate_page_for_quote(matched["quote"], cit_quote, page_start=page_start, page_end=page_end)
            elif matched.get("page") is not None:
                # Only populate/overwrite if page was missing
                if item.get("page") is None:
                    item["page"] = matched["page"]
            
            # Extract page from text page markers if still not resolved
            if item.get("page") is None:
                marker_page = _extract_page_from_text_markers(matched.get("quote") or "", cit_quote)
                if marker_page is not None:
                    item["page"] = marker_page
                    item["page_start"] = marker_page
                    item["page_end"] = marker_page
            
            if not item.get("filename"):
                item["filename"] = matched.get("filename")

        # Enrich fallback: if page is STILL missing but doc_id is known, pick best observation for that doc
        if item.get("page") is None and doc_id:
            entries = doc_entries.get(doc_id, [])
            if entries:
                best = entries[0]
                for entry in entries:
                    if entry.get("page") is not None:
                        best = entry
                        break
                item["page"] = best["page"]
                if not item.get("filename"):
                    item["filename"] = best.get("filename")
                # DO NOT overwrite item["quote"] or item["text"] if they are already present!
                if not item.get("quote"):
                    item["quote"] = best["quote"][:500]
                if not item.get("text"):
                    item["text"] = best["quote"][:500]

        # Enrich: if quote is missing but doc_id is known, pick best observation for that doc
        if not item.get("quote") and item.get("doc_id"):
            doc_id = str(item["doc_id"])
            entries = doc_entries.get(doc_id, [])
            if entries:
                # Pick entry with page info, preferring the one closest to the citation ref
                best = entries[0]
                for entry in entries:
                    if entry.get("page") is not None:
                        best = entry
                        break
                item["quote"] = best["quote"][:500]
                item["text"] = best["quote"][:500]
                item["preview"] = best["quote"][:500]
                if item.get("page") is None and best.get("page") is not None:
                    item["page"] = best["page"]
                if not item.get("filename"):
                    item["filename"] = best.get("filename")

    return annotations


def _annotations_from_observations(state: AgentRunState) -> list[Dict[str, Any]]:
    annotations: list[Dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for scratch in state.react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        candidates: list[Dict[str, Any]] = []
        if isinstance(observation.get("matches"), list):
            candidates.extend(item for item in observation["matches"] if isinstance(item, dict))
        if observation.get("snippet"):
            candidates.append(observation)
        for candidate in candidates:
            quote = str(candidate.get("quote") or candidate.get("snippet") or candidate.get("context") or "").strip()
            if not quote:
                continue
            doc_id = str(candidate.get("document_id") or candidate.get("doc_id") or "")
            key = (doc_id, quote[:160])
            if key in seen:
                continue
            seen.add(key)
            annotations.append({
                "type": "citation_data",
                "ref": len(annotations) + 1,
                "doc_id": doc_id or None,
                "document_id": doc_id or None,
                "filename": candidate.get("filename"),
                "page": candidate.get("page"),
                "page_start": candidate.get("page_start") or candidate.get("page"),
                "page_end": candidate.get("page_end"),
                "quote": quote[:500],
                "evidence_id": candidate.get("evidence_id") or candidate.get("segment_id"),
                "segment_id": candidate.get("evidence_id") or candidate.get("segment_id"),
            })
            if len(annotations) >= 8:
                return annotations
    return annotations


def _build_citations_from_tool_observations(state: AgentRunState, cited_refs: set[int]) -> list[Dict[str, Any]]:
    """Build citation annotations matching the model's inline [N] markers.

    Iterates through all tool observations sequentially, assigns each match a
    1-indexed position, and creates an annotation only when the position is in
    *cited_refs* (the marker numbers the model actually used).  This avoids the
    "pull in everything" behaviour of _annotations_from_observations, which can
    cause the wrong evidence to survive the citation filter chain.
    """
    annotations: list[Dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    position = 0

    for scratch in state.react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        matches = observation.get("matches")
        if not isinstance(matches, list):
            continue

        for candidate in matches:
            if not isinstance(candidate, dict):
                continue
            position += 1
            if position not in cited_refs:
                continue

            quote = str(candidate.get("quote") or candidate.get("snippet") or candidate.get("context") or "").strip()
            if not quote:
                continue
            doc_id = str(candidate.get("document_id") or candidate.get("doc_id") or "")
            key = (doc_id, quote[:160])
            if key in seen:
                continue
            seen.add(key)

            annotations.append({
                "type": "citation_data",
                "ref": position,
                "doc_id": doc_id or None,
                "document_id": doc_id or None,
                "filename": candidate.get("filename"),
                "page": candidate.get("page"),
                "page_start": candidate.get("page_start") or candidate.get("page"),
                "page_end": candidate.get("page_end"),
                "quote": quote[:500],
                "evidence_id": candidate.get("evidence_id") or candidate.get("segment_id"),
                "segment_id": candidate.get("evidence_id") or candidate.get("segment_id"),
            })

    if not annotations:
        return annotations

    # Renumber sequentially so Path A in _apply_answer_metadata uses
    # clean refs that match the inline markers the model wrote.
    for idx, ann in enumerate(annotations, start=1):
        ann["ref"] = idx

    return annotations


def _answer_from_observations(state: AgentRunState) -> str:
    annotations = _annotations_from_observations(state)
    if annotations:
        first = annotations[0]
        quote = str(first.get("quote") or "").strip()
        if quote:
            source = first.get("filename") or first.get("document_id") or first.get("doc_id") or "scoped evidence"
            page = first.get("page")
            evidence_id = first.get("segment_id")
            location = str(source)
            if page:
                location = f"{location}, p.{page}"
            if evidence_id:
                location = f"{location}, {evidence_id}"
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


def _append_agent_debug_log(workflow_id: str, iteration: int, prompt_str: str, raw_response_str: str):
    import datetime
    import os
    log_file_path = os.environ.get(
        "AGENT_DEBUG_LOG",
        "/Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/agent_debug.log",
    )
    try:
        with open(log_file_path, "a", encoding="utf-8") as f:
            f.write("=" * 80 + "\n")
            f.write(f"TIMESTAMP: {datetime.datetime.now().isoformat()}\n")
            f.write(f"WORKFLOW ID: {workflow_id}\n")
            f.write(f"ITERATION: {iteration}\n")
            f.write("=" * 80 + "\n\n")
            f.write("--- PROMPT / MESSAGES SENT TO AGENT (INCLUDES CHUNKS) ---\n")
            f.write(prompt_str + "\n")
            f.write("--- RAW RESPONSE FROM AGENT ---\n")
            f.write(raw_response_str + "\n\n")
    except Exception as e:
        print(f"Failed to write to agent_debug.log: {e}")


def _log_final_answer_debug(workflow_id: str, answer: str, citations: list):
    import json
    import os
    log_file_path = os.environ.get(
        "AGENT_DEBUG_LOG",
        "/Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/agent_debug.log",
    )
    try:
        with open(log_file_path, "a", encoding="utf-8") as f:
            f.write("=" * 80 + "\n")
            f.write(f"FINAL ANSWER FOR WORKFLOW ID: {workflow_id}\n")
            f.write("=" * 80 + "\n\n")
            f.write("--- ANSWER ---\n")
            f.write(answer + "\n\n")
            f.write("--- CITATIONS ---\n")
            f.write(json.dumps(citations, default=str, indent=2) + "\n\n")
    except Exception as e:
        print(f"Failed to write final answer to agent_debug.log: {e}")