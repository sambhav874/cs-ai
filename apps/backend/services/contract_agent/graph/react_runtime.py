"""LangGraph ReAct runtime for ContractSense."""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, Optional, Sequence

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool

from core.config import settings

from services.contract_agent.react_agent import ApprovalRequiredError
from services.contract_agent.system_prompt import langgraph_react_system_prompt_for_tools

from .approvals import ApprovalManager
from .state import (
    AgentRunState,
    AgentStatus,
    TabularColumnProposal,
    TabularReviewProposal,
    ToolCallRecord,
)
from .middleware import load_langchain_middleware
from .tools.langchain_tools import build_langchain_tools
from .tools.registry import FORBIDDEN_TOOLS


ToolExecutor = Callable[[ToolCallRecord, AgentRunState], Dict[str, Any]]


class ContractReActRuntime:
    """Thin state-bound wrapper around LangChain's LangGraph-backed agent."""

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
        self.max_iterations = max(1, int(max_iterations or getattr(settings, "contract_agent_max_react_iterations", 6) or 6))
        self.graph: Optional[Any] = None
        self.approvals = ApprovalManager()

    def run(self, state: AgentRunState, *, checkpoint_config: Optional[Dict[str, Any]] = None) -> AgentRunState:
        tools = build_langchain_tools(
            state=state,
            tool_executor=self.tool_executor,
            fallback_executor=self.fallback_executor,
        )
        system_prompt = langgraph_react_system_prompt_for_tools(tools)
        model: Optional[Any] = None
        try:
            model = self.model or build_chat_model(state)
            if _uses_gemini_transport(state, model):
                state.add_trace("model_step", action="gemini_safe_loop", reason_summary="Using Gemini-safe tool loop.")
                return self._run_gemini_tool_loop(state, model=model, tools=tools, system_prompt=system_prompt)
            self.graph = create_agent(
                model=model,
                tools=tools,
                system_prompt=system_prompt,
                middleware=load_langchain_middleware(model=model),
                checkpointer=self.checkpointer,
            )
            result = self.graph.invoke(
                {"messages": [HumanMessage(content=self._react_user_message(state))]},
                self._run_config(checkpoint_config),
            )
        except ApprovalRequiredError as exc:
            self._apply_approval_payload(state, exc.payload)
            return state
        except Exception as exc:
            approval_payload = self._pending_approval_payload(state)
            if approval_payload:
                self._apply_approval_payload(state, approval_payload)
                return state
            if model is not None and _is_gemini_function_call_signature_error(exc):
                state.add_trace(
                    "model_step",
                    action="gemini_safe_retry",
                    reason_summary="Retrying without replaying Gemini function-call history.",
                )
                try:
                    return self._run_gemini_tool_loop(state, model=model, tools=tools, system_prompt=system_prompt)
                except ApprovalRequiredError as approval_exc:
                    self._apply_approval_payload(state, approval_exc.payload)
                    return state
                except Exception as retry_exc:
                    exc = retry_exc
            synthesized = self._try_observation_synthesis(state, model=model, error=exc)
            if synthesized:
                return synthesized
            return self._finish_cannot_answer(
                state,
                answer=self._model_failure_answer(exc),
                reason=str(exc)[:800],
            )

        approval_payload = self._pending_approval_payload(state)
        if approval_payload:
            self._apply_approval_payload(state, approval_payload)
            return state

        messages = list(result.get("messages") or [])
        self._record_model_steps(state, messages, tools)
        answer = self._last_final_answer(messages)
        if not answer:
            return self._finish_cannot_answer(
                state,
                answer=(
                    "I could not produce a final answer because the model did not return one "
                    "within the allowed ReAct steps."
                ),
                reason="The LangGraph ReAct run ended without a final assistant answer.",
            )
        return self._finish_final_answer(state, answer=answer, reason="LangGraph ReAct agent produced the final answer.")

    def _run_gemini_tool_loop(
        self,
        state: AgentRunState,
        *,
        model: Any,
        tools: Sequence[BaseTool],
        system_prompt: str,
    ) -> AgentRunState:
        tools_by_name = {tool.name: tool for tool in tools}
        tool_model = model.bind_tools(tools) if hasattr(model, "bind_tools") else model
        for iteration in range(1, self.max_iterations + 1):
            response = tool_model.invoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=self._gemini_turn_message(state)),
            ])
            state.react_iterations = max(state.react_iterations, iteration)
            tool_calls = list(getattr(response, "tool_calls", None) or [])
            if tool_calls:
                call = tool_calls[0]
                name = str(call.get("name") or "").strip()
                args = call.get("args") if isinstance(call.get("args"), dict) else {}
                state.add_trace(
                    "model_step",
                    iteration=iteration,
                    action="tool_call",
                    tool=name or None,
                    reason_summary="Gemini selected a tool call.",
                )
                state.add_trace(
                    "react_model_step",
                    iteration=iteration,
                    action="tool",
                    tool=name or None,
                    reason="Gemini selected a tool call.",
                )
                if name in FORBIDDEN_TOOLS or name.startswith("send_") or name not in tools_by_name:
                    self._record_rejected_tool_call(state, name=name or "unknown", args=args, iteration=iteration)
                    continue
                try:
                    tools_by_name[name].invoke(args)
                except ApprovalRequiredError as exc:
                    self._apply_approval_payload(state, exc.payload)
                    return state
                except Exception as exc:
                    state.add_trace("tool_result", iteration=iteration, tool=name, status="error", summary=str(exc)[:500])
                continue

            answer = _message_text(response).strip()
            if answer:
                state.add_trace(
                    "model_step",
                    iteration=iteration,
                    action="final_answer",
                    reason_summary="Gemini produced the final answer.",
                )
                state.add_trace(
                    "react_model_step",
                    iteration=iteration,
                    action="final",
                    reason="Gemini produced the final answer.",
                )
                return self._finish_final_answer(state, answer=answer, reason="Gemini ReAct loop produced the final answer.")

        synthesized = self._try_observation_synthesis(
            state,
            model=model,
            error=RuntimeError("Gemini tool loop reached the allowed step limit."),
        )
        if synthesized:
            return synthesized
        return self._finish_cannot_answer(
            state,
            answer="I could not produce a final answer from the available scoped evidence.",
            reason="Gemini ReAct loop ended without a final answer.",
        )

    def _run_config(self, checkpoint_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        config: Dict[str, Any] = dict(checkpoint_config or {})
        if "configurable" in config:
            config["configurable"] = dict(config["configurable"] or {})
        config["recursion_limit"] = max(10, self.max_iterations * 4 + 6)
        return config

    def _react_user_message(self, state: AgentRunState) -> str:
        context = state.context
        selected_ids = context.selected_document_ids or context.reference_contract_ids
        memory = state.memory_context.strip() if state.memory_context else "No prior conversation memory for this session."
        return (
            f"User request:\n{state.message}\n\n"
            "Conversation memory:\n"
            f"{memory}\n\n"
            "Authorized ContractSense scope:\n"
            f"- surface: {context.surface.value}\n"
            f"- project_id: {context.project_id or 'N/A'}\n"
            f"- contract_id: {context.contract_id or 'N/A'}\n"
            f"- review_id: {context.review_id or 'N/A'}\n"
            f"- playbook_id: {context.playbook_id or 'N/A'}\n"
            f"- session_id: {context.session_id or 'N/A'}\n"
            f"- selected_document_ids: {selected_ids}\n"
            f"- displayed_document: {context.displayed_document or {}}\n"
            f"- attached_documents: {context.attached_documents or []}\n\n"
            "Only use tools inside this authorized scope."
        )

    def _gemini_turn_message(self, state: AgentRunState) -> str:
        observation_context = _observation_context(state)
        observations = observation_context or "No tool observations yet."
        return (
            f"{self._react_user_message(state)}\n\n"
            "Observed tool results so far:\n"
            f"{observations}\n\n"
            "Choose the next step. Either return a final answer, or call exactly one available tool. "
            "If the observed evidence is enough, answer now. If a tool observation says its budget is exhausted, do not call that tool again."
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
                    state.add_trace(
                        "model_step",
                        iteration=observed_ai_steps,
                        action="tool_call",
                        tool=name or None,
                        reason_summary="Model selected a tool call.",
                    )
                    state.add_trace(
                        "react_model_step",
                        iteration=observed_ai_steps,
                        action="tool",
                        tool=name or None,
                        reason="Model selected a tool call.",
                    )
                    if name in FORBIDDEN_TOOLS or name.startswith("send_") or name not in available_tools:
                        self._record_rejected_tool_call(state, name=name or "unknown", args=args, iteration=observed_ai_steps)
                continue

            content = _stringify_content(message.content).strip()
            if content:
                observed_ai_steps += 1
                state.add_trace(
                    "model_step",
                    iteration=observed_ai_steps,
                    action="final_answer",
                    reason_summary="Model produced the final answer.",
                )
                state.add_trace(
                    "react_model_step",
                    iteration=observed_ai_steps,
                    action="final",
                    reason="Model produced the final answer.",
                )
                self._add_token_usage_from_message(state, message)
        state.react_iterations = max(state.react_iterations, observed_ai_steps)

    def _record_rejected_tool_call(self, state: AgentRunState, *, name: str, args: Dict[str, Any], iteration: int) -> None:
        if any(tool.name == name and tool.status == "rejected" for tool in state.tools):
            return
        record = ToolCallRecord(
            name=name,
            args=args,
            status="rejected",
            reason="ToolPolicyMiddleware rejected an unknown or forbidden model-selected tool.",
            iteration=iteration,
            observation={"summary": "Rejected unknown or forbidden tool.", "risk": "forbidden"},
        )
        state.tools.append(record)
        state.react_scratchpad.append({
            "iteration": iteration,
            "tool": name,
            "status": record.status,
            "observation": record.observation,
        })
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
        if tool_name == "suggest_tabular_review":
            tool_name = "create_tabular_review"
            payload = {**payload, "tool": tool_name}
        if tool_name == "create_tabular_review":
            proposal = self._tabular_proposal_from_payload(state, payload)
            state.tabular_proposal = proposal
            state.approval_request = self.approvals.tabular_request(workflow_id=state.workflow_id, proposal=proposal)
        else:
            state.approval_request = self.approvals.tool_request(
                workflow_id=state.workflow_id,
                action=tool_name,
                payload=payload,
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

    def _finish_final_answer(self, state: AgentRunState, *, answer: str, reason: str) -> AgentRunState:
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
        try:
            response = model.invoke([
                SystemMessage(content=(
                    "You are ContractSense. Tool use is now closed for this turn. "
                    "Write the final answer from the observed tool evidence only. "
                    "If the observed evidence is insufficient, say the scoped evidence does not contain the answer. "
                    "Do not mention recursion limits or internal tool budgets. "
                    "Cite document, page, section, or evidence IDs when available."
                )),
                HumanMessage(content=(
                    f"User request:\n{state.message}\n\n"
                    "Observed evidence and tool results:\n"
                    f"{observation_context}\n\n"
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
        state.add_trace(
            "model_step",
            iteration=state.react_iterations,
            action="final_answer",
            reason_summary="Model synthesized a final answer after tool budget exhaustion.",
        )
        state.add_trace(
            "react_model_step",
            iteration=state.react_iterations,
            action="final",
            reason="Model synthesized a final answer after tool budget exhaustion.",
        )
        return self._finish_final_answer(
            state,
            answer=answer,
            reason="Model synthesized the final answer from observed tool evidence after tool budget exhaustion.",
        )

    def _apply_answer_metadata(self, state: AgentRunState) -> None:
        confidence_match = re.search(r"\*\*Confidence:\*\*\s*(high|medium|low)", state.answer, flags=re.IGNORECASE)
        if confidence_match:
            state.confidence = confidence_match.group(1).lower()  # type: ignore[assignment]
        elif state.react_scratchpad:
            state.confidence = "medium"
        elif state.answer:
            state.confidence = "high"

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
                        "page": item.get("page"),
                        "contract_id": item.get("doc_id"),
                        "contract_name": item.get("filename"),
                        "type": "react_tool_observation",
                    }
                    for index, item in enumerate(annotations, start=1)
                ],
                "citation_style": "react_tool_observation",
            }

    def _add_token_usage_from_message(self, state: AgentRunState, message: AIMessage) -> None:
        usage = getattr(message, "usage_metadata", None) or (message.response_metadata or {}).get("token_usage") or {}
        input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
        if input_tokens or output_tokens:
            state.token_usage.input_tokens += input_tokens
            state.token_usage.output_tokens += output_tokens
            state.token_usage.total_tokens += input_tokens + output_tokens

    def _model_failure_answer(self, exc: Exception) -> str:
        text = str(exc) or exc.__class__.__name__
        if "recursion" in text.lower() or "recursion limit" in text.lower():
            return (
                "I could not produce a final answer because the model kept using tools and hit "
                "the allowed ReAct step limit."
            )
        return f"I cannot answer because the model-led agent failed before producing a final response: {text[:300]}"


def build_chat_model(state: AgentRunState) -> Any:
    provider = _normalize_provider_name(state.ai_provider or getattr(settings, "ai_provider", None) or "groq")
    temperature = float(getattr(settings, "temperature", 0) or 0)
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


def _is_gemini_provider(state: AgentRunState) -> bool:
    return _normalize_provider_name(state.ai_provider or getattr(settings, "ai_provider", None) or "") == "gemini"


def _uses_gemini_transport(state: AgentRunState, model: Any) -> bool:
    if _is_gemini_provider(state):
        return True
    model_type = f"{model.__class__.__module__}.{model.__class__.__name__}".lower()
    return (
        "langchain_google_genai" in model_type
        or "chatgooglegenerativeai" in model_type
        or ("google" in model_type and "genai" in model_type)
        or ("gemini" in model_type)
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


def _is_gemini_function_call_signature_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return "thought_signature" in text and ("functioncall" in text or "function call" in text)


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
        matches = observation.get("matches")
        if isinstance(matches, list):
            for item in matches[:5]:
                if not isinstance(item, dict):
                    continue
                quote = str(item.get("quote") or item.get("snippet") or item.get("context") or "").strip()
                if not quote:
                    continue
                source = item.get("filename") or item.get("document_id") or item.get("doc_id") or "Scoped document"
                page = item.get("page")
                evidence_id = item.get("evidence_id") or item.get("segment_id")
                location = f"{source}" + (f", p.{page}" if page else "")
                suffix = f" [{evidence_id}]" if evidence_id else ""
                lines.append(f"  - {location}{suffix}: {quote[:900]}")
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
            return (
                f"{quote}\n\n"
                f"Source: {location}\n\n"
                "**Confidence:** medium"
            )

    observation_context = _observation_context(state).strip()
    if observation_context:
        return (
            "Based on the scoped tool observations:\n"
            f"{observation_context}\n\n"
            "**Confidence:** medium"
        )
    return ""


def _coerce_string_list(value: Any) -> list[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)] if str(value).strip() else []
