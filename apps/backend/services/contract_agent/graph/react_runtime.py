"""Unified ReAct runtime for ContractSense.

A single model-agnostic tool loop that replaces the dual
LangGraph create_agent / Gemini-safe paths with one implementation.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, Optional, Sequence, Tuple

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage
from langchain_core.tools import BaseTool

from core.config import settings

from services.contract_agent.react_agent import ApprovalRequiredError
from services.contract_agent.system_prompt import build_adaptive_system_prompt

from .approvals import ApprovalManager
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

VERIFICATION_ENABLED_TASKS = frozenset({
    "qa", "compare", "kpi", "risk",
})


class ContractReActRuntime:
    """Unified state-bound ReAct loop for all model providers."""

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
        self._config_max_iterations = max(1, int(max_iterations or getattr(settings, "contract_agent_max_react_iterations", 10) or 10))
        self.max_iterations = self._config_max_iterations
        self.approvals = ApprovalManager()

    def run(self, state: AgentRunState, *, checkpoint_config: Optional[Dict[str, Any]] = None, on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None) -> AgentRunState:
        tools = build_langchain_tools(
            state=state,
            tool_executor=self.tool_executor,
            fallback_executor=self.fallback_executor,
        )

        self.max_iterations = DEFAULT_MAX_ITERATIONS

        system_prompt = build_adaptive_system_prompt(
            tools=tools,
            message=state.message,
            document_count=len(state.context.selected_document_ids or []),
            attached_documents=state.context.attached_documents or None,
        )

        model: Any = None
        try:
            model = self.model or _build_chat_model(state)
            return self._run_unified_tool_loop(state, model=model, tools=tools, system_prompt=system_prompt, on_event=on_event)
        except ApprovalRequiredError as exc:
            self._apply_approval_payload(state, exc.payload)
            return state
        except Exception as exc:
            approval_payload = self._pending_approval_payload(state)
            if approval_payload:
                self._apply_approval_payload(state, approval_payload)
                return state
            synthesized = self._try_observation_synthesis(state, model=model, error=exc)
            if synthesized:
                return synthesized
            return self._finish_cannot_answer(
                state,
                answer=self._model_failure_answer(exc),
                reason=str(exc)[:800],
            )

    def _run_unified_tool_loop(
        self,
        state: AgentRunState,
        *,
        model: Any,
        tools: Sequence[BaseTool],
        system_prompt: str,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> AgentRunState:
        tools_by_name = {tool.name: tool for tool in tools}
        tool_model = model.bind_tools(tools) if hasattr(model, "bind_tools") else model

        for iteration in range(1, self.max_iterations + 1):
            if on_event:
                on_event("status", {"message": f"Thinking (step {iteration})", "iteration": iteration})

            # Setup streaming content buffer and tags filter
            citations_open_tag = "<citation"
            citations_open_seen = False
            visible_tail_buffer = ""

            def stream_visible_content(delta: str):
                nonlocal citations_open_seen, visible_tail_buffer
                if not delta:
                    return
                if citations_open_seen:
                    return

                combined = visible_tail_buffer + delta
                marker_idx = combined.lower().find(citations_open_tag)
                if marker_idx >= 0:
                    visible = combined[:marker_idx]
                    if visible and on_event:
                        on_event("delta", {"text": visible})
                        on_event("text", {"text": visible})
                    visible_tail_buffer = ""
                    citations_open_seen = True
                    return

                keep = min(len(citations_open_tag) - 1, len(combined))
                visible = combined[:-keep] if keep > 0 else combined
                visible_tail_buffer = combined[-keep:] if keep > 0 else ""
                if visible and on_event:
                    on_event("delta", {"text": visible})
                    on_event("text", {"text": visible})

            def flush_visible_tail():
                nonlocal visible_tail_buffer
                if not citations_open_seen and visible_tail_buffer:
                    if on_event:
                        on_event("delta", {"text": visible_tail_buffer})
                        on_event("text", {"text": visible_tail_buffer})
                visible_tail_buffer = ""

            response = None
            has_tool_calls = False

            # Use stream to stream token chunks from the LLM
            stream_iterator = tool_model.stream([
                SystemMessage(content=system_prompt),
                HumanMessage(content=self._build_turn_message(state, iteration, self.max_iterations)),
            ])

            for chunk in stream_iterator:
                if response is None:
                    response = chunk
                else:
                    response += chunk

                # Detect tool calls — Gemini may emit tool_calls directly, not tool_call_chunks
                if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                    has_tool_calls = True
                if hasattr(chunk, "tool_calls") and chunk.tool_calls:
                    has_tool_calls = True
                if getattr(chunk, "additional_kwargs", {}).get("function_call"):
                    has_tool_calls = True

                # Stream the content delta as it arrives (if no tool calls detected)
                delta_content = _stringify_content(chunk.content)
                if delta_content and not has_tool_calls:
                    stream_visible_content(delta_content)

                # Stream reasoning/thinking if available (e.g. DeepSeek/OpenAI o1/o3/Claude thinking)
                reasoning_delta = getattr(chunk, "reasoning_content", None)
                if reasoning_delta and on_event:
                    on_event("thinking", {"message": reasoning_delta, "iteration": iteration})

            # Flush any remaining visible content delta
            if not has_tool_calls:
                flush_visible_tail()

            state.react_iterations = max(state.react_iterations, iteration)

            thought = _message_text(response).strip()
            if thought and has_tool_calls and on_event:
                on_event("thinking", {"message": thought, "iteration": iteration})

            tool_calls = list(getattr(response, "tool_calls", None) or [])
            if tool_calls:
                self._handle_tool_calls(state, tool_calls, tools_by_name, iteration, on_event=on_event)
                continue

            answer = _message_text(response).strip()
            if answer:
                state.add_trace("model_step", iteration=iteration, action="final_answer", reason_summary="Model produced the final answer.")
                state.add_trace("react_model_step", iteration=iteration, action="final", reason="Model produced the final answer.")
                self._add_token_usage_from_message(state, response)
                if on_event:
                    on_event("status", {"message": "Verifying answer", "iteration": iteration})
                return self._verified_finish(state, answer=answer, model=model,
                    reason="Unified ReAct loop produced the final answer.")

        synthesized = self._try_observation_synthesis(
            state, model=model,
            error=RuntimeError("ReAct loop reached the allowed step limit."),
        )
        if synthesized:
            return synthesized
        return self._finish_cannot_answer(
            state,
            answer="I could not produce a final answer from the available scoped evidence.",
            reason="ReAct loop ended without a final answer.",
        )

    def _handle_tool_calls(
        self,
        state: AgentRunState,
        tool_calls: list[dict[str, Any]],
        tools_by_name: dict[str, BaseTool],
        iteration: int,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> None:
        for call in tool_calls[:1]:
            name = str(call.get("name") or "").strip()
            args = call.get("args") if isinstance(call.get("args"), dict) else {}

            state.add_trace("model_step", iteration=iteration, action="tool_call",
                tool=name or None, reason_summary="Model selected a tool call.")
            state.add_trace("react_model_step", iteration=iteration, action="tool",
                tool=name or None, reason="Model selected a tool call.")

            if on_event:
                on_event("tool_call", {"name": name, "args": args, "iteration": iteration})

            if name in FORBIDDEN_TOOL_NAMES or name.startswith("send_") or name not in tools_by_name:
                self._record_rejected_tool_call(state, name=name or "unknown", args=args, iteration=iteration)
                if on_event:
                    on_event("tool_result", {
                        "name": name or "unknown",
                        "summary": "Tool rejected.",
                        "status": "rejected",
                        "iteration": iteration
                    })
                return

            try:
                tools_by_name[name].invoke(args)
                if on_event:
                    if state.tools:
                        last_tool = state.tools[-1]
                        on_event("tool_result", {
                            "name": last_tool.name,
                            "summary": last_tool.observation.get("summary") or "Executed.",
                            "status": last_tool.status,
                            "iteration": iteration
                        })
            except ApprovalRequiredError as exc:
                self._apply_approval_payload(state, exc.payload)
                if on_event:
                    on_event("tool_result", {
                        "name": name,
                        "summary": "Approval required.",
                        "status": "planned",
                        "iteration": iteration
                    })
                raise
            except Exception as exc:
                state.add_trace("tool_result", iteration=iteration, tool=name,
                    status="error", summary=str(exc)[:500])
                if on_event:
                    on_event("tool_result", {
                        "name": name,
                        "summary": str(exc)[:500],
                        "status": "error",
                        "iteration": iteration
                    })

    def _build_turn_message(self, state: AgentRunState, iteration: int, max_iterations: int) -> str:
        context = state.context
        selected_ids = context.selected_document_ids or context.reference_contract_ids
        memory = state.memory_context.strip() if state.memory_context else "No prior conversation memory for this session."

        # Build document inventory from attached documents
        attached = context.attached_documents or []
        doc_lines = []
        for doc in attached:
            filename = doc.get("filename") or doc.get("name") or "Unknown"
            doc_id = doc.get("document_id") or doc.get("id") or "?"
            doc_lines.append(f"  - {filename} (ID: {doc_id})")
        doc_inventory = "\n".join(doc_lines) if doc_lines else "No documents attached."

        # Build prior tool call summary
        prior_tools = []
        for tool_rec in state.tools[-5:]:
            status = tool_rec.status
            args_summary = str(tool_rec.args)[:100] if tool_rec.args else ""
            prior_tools.append(f"  - {tool_rec.name}({args_summary}) → {status}")
        prior_actions = "\n".join(prior_tools) if prior_tools else "None yet."

        scope = (
            f"User request:\n{state.message}\n\n"
            f"Conversation memory:\n{memory}\n\n"
            f"Documents in scope ({len(attached)}):\n{doc_inventory}\n\n"
            f"Authorized ContractSense scope:\n"
            f"- surface: {context.surface.value}\n"
            f"- project_id: {context.project_id or 'N/A'}\n"
            f"- contract_id: {context.contract_id or 'N/A'}\n"
            f"- selected_document_ids: {selected_ids}\n\n"
            f"Prior tool calls this run:\n{prior_actions}\n\n"
            "Only use tools inside this authorized scope."
        )

        observation_context = _observation_context(state)
        observations = observation_context or "No tool observations yet."
        return (
            f"{scope}\n\n"
            f"Observed tool results so far (step {iteration} of {max_iterations}):\n"
            f"{observations}\n\n"
            "Choose your next step. Either:\n"
            "- Call exactly one tool to gather evidence or take an action\n"
            "- Return a final answer if you have enough evidence\n"
            "- Suggest a workflow (draft, redline, tabular review, risk review, KPI extraction, "
            "document export) if the user's request would benefit from it\n\n"
            "If the observed evidence is enough, answer now. If a tool observation says its budget is exhausted, "
            "do not call that tool again."
        )

    def _record_model_steps(
        self,
        state: AgentRunState,
        messages: Sequence[BaseMessage],
        tools: Sequence[BaseTool],
    ) -> None:
        available_tools = {tool.name for tool in tools}
        observed_ai_steps = 0
        for message in messages:
            if not isinstance(message, AIMessage):
                continue
            tool_calls = list(getattr(message, "tool_calls", None) or [])
            if tool_calls:
                observed_ai_steps += 1
                for call in tool_calls:
                    name = str(call.get("name") or "").strip()
                    args = call.get("args") if isinstance(call.get("args"), dict) else {}
                    state.add_trace("model_step", iteration=observed_ai_steps, action="tool_call",
                        tool=name or None, reason_summary="Model selected a tool call.")
                    state.add_trace("react_model_step", iteration=observed_ai_steps, action="tool",
                        tool=name or None, reason="Model selected a tool call.")
                    if name in FORBIDDEN_TOOL_NAMES or name.startswith("send_") or name not in available_tools:
                        self._record_rejected_tool_call(state, name=name or "unknown", args=args, iteration=observed_ai_steps)
                continue
            content = _stringify_content(message.content).strip()
            if content:
                observed_ai_steps += 1
                state.add_trace("model_step", iteration=observed_ai_steps, action="final_answer",
                    reason_summary="Model produced the final answer.")
                state.add_trace("react_model_step", iteration=observed_ai_steps, action="final",
                    reason="Model produced the final answer.")
                self._add_token_usage_from_message(state, message)
        state.react_iterations = max(state.react_iterations, observed_ai_steps)

    def _record_rejected_tool_call(self, state: AgentRunState, *, name: str, args: Dict[str, Any], iteration: int) -> None:
        if any(tool.name == name and tool.status == "rejected" for tool in state.tools):
            return
        record = ToolCallRecord(
            name=name, args=args, status="rejected",
            reason="ToolPolicyMiddleware rejected an unknown or forbidden model-selected tool.",
            iteration=iteration,
            observation={"summary": "Rejected unknown or forbidden tool.", "risk": "forbidden"},
        )
        state.tools.append(record)
        state.react_scratchpad.append({"iteration": iteration, "tool": name, "status": record.status, "observation": record.observation})
        state.add_trace("tool_start", iteration=iteration, tool=name, args=args)
        state.add_trace("tool_result", iteration=iteration, tool=name, status="rejected", summary=record.observation["summary"])

    def _last_final_answer(self, messages: Sequence[BaseMessage]) -> str:
        for message in reversed(messages):
            if not isinstance(message, AIMessage):
                continue
            if getattr(message, "tool_calls", None):
                continue
            content = _stringify_content(message.content).strip()
            if content:
                return content
        return ""

    def _apply_approval_payload(self, state: AgentRunState, payload: Dict[str, Any]) -> None:
        tool_name = str(payload.get("tool") or "").strip()
        if tool_name == "create_tabular_review" or tool_name == "suggest_tabular_review":
            proposal = self._tabular_proposal_from_payload(state, payload)
            state.tabular_proposal = proposal
            state.approval_request = self.approvals.tabular_request(workflow_id=state.workflow_id, proposal=proposal)
        else:
            state.approval_request = self.approvals.tool_request(
                workflow_id=state.workflow_id, action=tool_name, payload=payload)
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

    def _parse_and_resolve_citations(self, answer: str, state: AgentRunState) -> list[dict[str, Any]]:
        # Find CITATIONS block
        match = re.search(r"<CITATIONS?>\s*([\s\S]*?)\s*(?:</CITATIONS?>|$)", answer, re.IGNORECASE)
        if not match:
            return []
        
        raw_content = match.group(1).strip()
        try:
            # Clean up the JSON if it contains markdown formatting blocks or is wrapped in standard markdown
            if raw_content.startswith("```"):
                lines = raw_content.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                raw_content = "\n".join(lines).strip()
            raw_citations = json.loads(raw_content)
            if not isinstance(raw_citations, list):
                return []
        except Exception:
            return []
            
        resolved = []
        doc_index = {}
        attached = state.context.attached_documents or []
        
        # Populate doc_index from attached documents
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

        # Also support mapping from state.context.selected_document_ids
        selected_ids = state.context.selected_document_ids or []
        for i, doc_id in enumerate(selected_ids):
            doc_label = f"doc-{i}"
            if doc_label not in doc_index:
                filename = doc_label
                for t in state.tools:
                    obs = t.observation
                    if isinstance(obs, dict):
                        matches = obs.get("matches") or []
                        if isinstance(matches, list):
                            for m in matches:
                                if isinstance(m, dict) and (m.get("document_id") == doc_id or m.get("doc_id") == doc_id):
                                    filename = m.get("filename") or filename
                                    break
                doc_info = {
                    "document_id": doc_id,
                    "filename": filename,
                    "version_id": None,
                    "version_number": None,
                }
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
            page = item.get("page")
            if isinstance(page, str) and "-" in page:
                pass
            elif page is None:
                page = None  # keep null, don't default to 1
            else:
                try:
                    page = int(page)
                except (ValueError, TypeError):
                    page = None
                    
            doc_info = doc_index.get(raw_doc_id)
            if not doc_info:
                # Fallback check: search by filename or document_id case-insensitively
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
                "quote": quote,
                "text": quote,       # ← add this
                "preview": quote,    # ← and this
})
            
        return resolved

    def _finish_final_answer(self, state: AgentRunState, *, answer: str, reason: str) -> AgentRunState:
        # Try parsing model-generated citations first if not already parsed
        if not state.citation_annotations:
            model_citations = self._parse_and_resolve_citations(answer, state)
            if model_citations:
                answer = re.sub(r"<CITATIONS>[\s\S]*?(?:</CITATIONS>|$)", "", answer, flags=re.IGNORECASE).strip()
                state.citation_annotations = model_citations

        state.answer = answer.strip()
        state.reason = reason
        state.status = AgentStatus.COMPLETED
        state.react_complete = True
        self._apply_answer_metadata(state)
        state.add_trace("verify_answer", issue_count=len(state.verifier_issues))
        state.add_trace("final", action="final_answer", confidence=state.confidence)
        return state

    def _finish_cannot_answer(self, state: AgentRunState, *, answer: str, reason: str) -> AgentRunState:
        state.answer = answer.strip()
        state.reason = reason
        state.status = AgentStatus.COMPLETED
        state.confidence = "low"
        state.react_complete = True
        state.add_trace("verify_answer", issue_count=len(state.verifier_issues))
        state.add_trace("final", action="cannot_answer", reason=reason[:500])
        return state

    def _verified_finish(self, state: AgentRunState, *, answer: str, model: Any, reason: str) -> AgentRunState:
        # Parse citations from raw answer and store in state
        model_citations = self._parse_and_resolve_citations(answer, state)
        clean_answer = answer
        if model_citations:
            clean_answer = re.sub(r"<CITATIONS>[\s\S]*?(?:</CITATIONS>|$)", "", answer, flags=re.IGNORECASE).strip()
            state.citation_annotations = model_citations

        verified, passed = self._verify_final_answer(state, clean_answer, model)
        if verified and verified != clean_answer:
            state.add_trace("verification", result="corrected",
                reason_summary="Self-verification caught issues and corrected the answer.")
            return self._finish_final_answer(state, answer=verified,
                reason=f"{reason} (self-verified, corrections applied)")
        if passed:
            state.add_trace("verification", result="passed",
                reason_summary="Self-verification found no issues.")
            return self._finish_final_answer(state, answer=clean_answer,
                reason=f"{reason} (self-verified)")
        return self._finish_final_answer(
            state, answer=clean_answer,
            reason=f"{reason} (verification unavailable, answer returned as-is)")

    def _verify_final_answer(self, state: AgentRunState, answer: str, model: Any) -> tuple[Optional[str], bool]:
        # Always attempt verification — the LLM decides if the answer is verifiable
        observation_context = _observation_context(state)
        if not observation_context:
            return None, True

        try:
            response = model.invoke([
                SystemMessage(content=(
                    "You are ContractSense Verifier. Review this answer against the observed tool evidence.\n\n"
                    "Checks:\n"
                    "1. Every factual contract claim is backed by observed evidence from search_evidence or find_in_document results. "
                    "Mark unsupported claims by adding [UNCITED] after them.\n"
                    "2. All [N] citation markers in the answer correspond to evidence actually observed. "
                    "Remove orphaned markers that don't correspond to anything observed.\n"
                    "3. The answer does not contradict any observed evidence. "
                    "Flag contradictions by adding [CONTRADICTS: <reason>] after the contradictory claim.\n"
                    "4. If the scoped evidence didn't contain the answer, the answer correctly says so rather than guessing.\n\n"
                    "Return format:\n"
                    "- If no issues found: prefix with 'PASS: ' then the answer unchanged.\n"
                    "- If corrections applied: prefix with 'FIXED: ' then the corrected answer.\n"
                    "- Never add facts not present in the observed evidence."
                )),
                HumanMessage(content=(
                    f"Observed tool evidence:\n{observation_context[:4000]}\n\n"
                    f"Answer to verify:\n{answer}"
                )),
            ])
        except Exception:
            state.add_trace("verification", result="failed", reason_summary="Verification model call failed.")
            return None, False

        verified_text = _message_text(response).strip()
        if verified_text.startswith("PASS: "):
            return answer, True
        if verified_text.startswith("FIXED: "):
            return verified_text[len("FIXED: "):].strip(), True
        return None, True

    def _try_observation_synthesis(
        self,
        state: AgentRunState,
        *,
        model: Optional[Any],
        error: Exception,
    ) -> Optional[AgentRunState]:
        if not model or not state.react_scratchpad:
            return None
        error_text = str(error) or error.__class__.__name__
        if "recursion" not in error_text.lower() and "step limit" not in error_text.lower():
            return None

        observation_context = _observation_context(state)
        if not observation_context:
            return None

        pruned = observation_context[:3000]
        try:
            response = model.invoke([
                SystemMessage(content=(
                    "You are ContractSense. Tool use is now closed for this turn. "
                    "Synthesize the final answer from the observed tool evidence only. "
                    "If the observed evidence is insufficient, say the scoped evidence does not contain the answer. "
                    "Do not mention recursion limits or internal tool budgets. "
                    "Cite document, page, section, or evidence IDs when available."
                )),
                HumanMessage(content=(
                    f"User request:\n{state.message}\n\n"
                    "Observed evidence and tool results:\n"
                    f"{pruned}\n\n"
                    "Produce the final user-facing answer now."
                )),
            ])
        except Exception as synthesis_exc:
            state.add_trace("model_step", action="final_synthesis_failed", reason_summary=str(synthesis_exc)[:300])
            return None

        answer = _message_text(response).strip()
        if not answer:
            answer = _answer_from_observations(state)
        if not answer:
            return None

        state.react_iterations = max(state.react_iterations, len(state.react_scratchpad) + 1)
        state.add_trace("model_step", iteration=state.react_iterations, action="final_answer",
            reason_summary="Model synthesized a final answer after tool budget exhaustion.")
        state.add_trace("react_model_step", iteration=state.react_iterations, action="final",
            reason="Model synthesized a final answer after tool budget exhaustion.")
        return self._finish_final_answer(state, answer=answer,
            reason="Model synthesized the final answer from observed tool evidence after tool budget exhaustion.")

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
            state.answer = _normalize_answer_citation_markers(state.answer, annotations)
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
                state.answer = _normalize_answer_citation_markers(state.answer, annotations)
                state.citation_annotations = annotations
                state.citation_details = {
                    "annotations": annotations,
                    "cited_segments": [
                        {
                            "id": item.get("segment_id") or f"react-observation-{index}",
                            "text": item.get("quote", ""),
                            "quote": item.get("quote", ""),
                            "preview": item.get("quote", ""),
                            "page": item.get("page"),
                            "page_number": item.get("page"),
                            "contract_id": item.get("doc_id"),
                            "contract_name": item.get("filename"),
                            "type": "react_tool_observation",
                            "verified": item.get("verified", True),
                        }
                        for index, item in enumerate(annotations, start=1)
                    ],
                    "citation_style": "react_tool_observation",
                }

    def _add_token_usage_from_message(self, state: AgentRunState, message: Any) -> None:
        usage = getattr(message, "usage_metadata", None) or (getattr(message, "response_metadata", None) or {}).get("token_usage") or {}
        input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
        if input_tokens or output_tokens:
            state.token_usage.input_tokens += input_tokens
            state.token_usage.output_tokens += output_tokens
            state.token_usage.total_tokens += input_tokens + output_tokens

    def _model_failure_answer(self, exc: Exception) -> str:
        text = str(exc) or exc.__class__.__name__
        if "recursion" in text.lower() or "recursion limit" in text.lower():
            return "I could not produce a final answer because the model kept using tools and hit the allowed ReAct step limit."
        return f"I cannot answer because the model-led agent failed before producing a final response: {text[:300]}"


# ── Model factory ──────────────────────────────────────────────────────────


def _build_chat_model(state: AgentRunState, *, task_type: str = "default") -> Any:
    provider = _normalize_provider_name(state.ai_provider or getattr(settings, "ai_provider", None) or "groq")
    temperature = 0.1
    allowed = getattr(settings, "temperature", None)
    if allowed is not None:
        temperature = float(allowed)
    max_tokens = int(getattr(settings, "max_tokens", 2048) or 2048)

    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=getattr(settings, "gemini_model_name", None) or "gemini-2.0-flash",
            google_api_key=getattr(settings, "gemini_api_key", None),
            temperature=temperature,
            max_output_tokens=max_tokens,
        )
    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=getattr(settings, "openai_model_name", None) or "gpt-4o-mini",
            api_key=getattr(settings, "openai_api_key", None),
            temperature=temperature,
            max_tokens=max_tokens,
        )
    if provider == "claude":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=getattr(settings, "anthropic_model_name", None) or getattr(settings, "claude_model_name", None),
            api_key=getattr(settings, "anthropic_api_key", None),
            temperature=temperature,
            max_tokens=max_tokens,
        )
    from langchain_groq import ChatGroq
    return ChatGroq(
        model=getattr(settings, "model_name", None) or "llama-3.3-70b-versatile",
        groq_api_key=getattr(settings, "groq_api_key", None),
        temperature=temperature,
        max_tokens=max_tokens,
    )


def _normalize_provider_name(provider: Any) -> str:
    value = str(provider or "").strip().lower().replace("-", "_")
    if not value:
        return ""
    if "gemini" in value or "google_genai" in value or value in {"google", "genai"}:
        return "gemini"
    if value in {"openai", "gpt"} or value.startswith("gpt_"):
        return "openai"
    if value in {"anthropic", "claude"}:
        return "claude"
    return value


# ── Text helpers ───────────────────────────────────────────────────────────


def _stringify_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
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


def _normalize_answer_citation_markers(answer: str, annotations: list[Dict[str, Any]]) -> str:
    if not answer or not annotations:
        return answer
    marker_to_ref: dict[str, str] = {}
    for annotation in annotations:
        ref = annotation.get("ref")
        if not ref:
            continue
        ref_text = str(ref)
        for key in ("segment_id", "evidence_id", "source_id", "id"):
            value = annotation.get(key)
            if value:
                marker_to_ref[str(value).strip()] = ref_text
    if not marker_to_ref:
        return answer

    def replace_marker(match: re.Match[str]) -> str:
        marker = match.group(1).strip()
        if marker.isdigit():
            return match.group(0)
        ref = marker_to_ref.get(marker)
        return f"[{ref}]" if ref else match.group(0)
    return re.sub(r"\[([A-Za-z0-9:_\-]{8,})\]", replace_marker, answer)


def _enrich_citations_from_observations(annotations: list[Dict[str, Any]], state: AgentRunState) -> list[Dict[str, Any]]:
    if not annotations:
        return annotations

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
            quote = str(candidate.get("quote") or candidate.get("snippet") or candidate.get("context") or "").strip()
            if not quote:
                continue
            obs_entries.append({
                "doc_id": str(candidate.get("document_id") or candidate.get("doc_id") or ""),
                "filename": candidate.get("filename"),
                "page": candidate.get("page"),
                "quote": quote,
            })

    if not obs_entries:
        return annotations

    # Build lookup by (doc_id, quote prefix)
    quote_lookup: dict[Tuple[str, str], Dict[str, Any]] = {}
    doc_entries: dict[str, list[Dict[str, Any]]] = {}
    for entry in obs_entries:
        doc_id = entry["doc_id"]
        if doc_id:
            doc_entries.setdefault(doc_id, []).append(entry)
        quote_key = (doc_id, entry["quote"][:80].lower())
        if quote_key not in quote_lookup:
            quote_lookup[quote_key] = entry

    for item in annotations:
        # Enrich: if page is missing but quote is present, find matching observation
        if item.get("page") is None and item.get("quote"):
            cit_quote = str(item["quote"]).strip()
            if cit_quote:
                doc_id = str(item.get("doc_id") or item.get("document_id") or "")
                # Try exact match first, then fuzzy prefix overlap
                match_key = (doc_id, cit_quote[:80].lower())
                matched = quote_lookup.get(match_key)
                if not matched:
                    # Try shorter prefix match
                    for key, entry in quote_lookup.items():
                        if key[0] != doc_id:
                            continue
                        if cit_quote[:40].lower() in key[1] or key[1] in cit_quote[:40].lower():
                            matched = entry
                            break
                if matched and matched.get("page") is not None:
                    item["page"] = matched["page"]
                    if matched.get("quote") and matched["quote"] != item["quote"]:
                        item["quote"] = matched["quote"][:500]
                        item["text"] = matched["quote"][:500]

        # Enrich: if page is STILL missing but doc_id is known, pick best observation for that doc
        if item.get("page") is None and item.get("doc_id"):
            doc_id = str(item["doc_id"])
            entries = doc_entries.get(doc_id, [])
            if entries:
                best = entries[0]
                for entry in entries:
                    if entry.get("page") is not None:
                        best = entry
                        break
                item["page"] = best["page"]
                item["quote"] = best["quote"][:500]
                item["text"] = best["quote"][:500]
                if not item.get("filename"):
                    item["filename"] = best.get("filename")

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
                "quote": quote[:500],
                "evidence_id": candidate.get("evidence_id") or candidate.get("segment_id"),
                "segment_id": candidate.get("evidence_id") or candidate.get("segment_id"),
            })
            if len(annotations) >= 8:
                return annotations
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
