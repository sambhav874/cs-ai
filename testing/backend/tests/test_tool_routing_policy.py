"""Tool routing is prompt and tool-description policy, not post-hoc string surgery.

1.3 deleted `_repair_follow_up_tool_choice`, which pattern-matched the user's
question and silently swapped the model's chosen tool — anything matching
`summary|overview|whole contract` became `outline_document` with an empty
document_id, and a short follow-up on a KPI topic became `get_kpi_context`.

Two problems with that: it was unobservable (the model was never told its choice
had been overridden), and the coverage rule it enforced was *already* written in
the system prompt, so the two could drift apart.

These tests hold the replacement in place: the intent has to be legible in the
tool surface and the prompt, and the runtime must pass the model's chosen tools
through untouched.
"""

from __future__ import annotations

import pytest


def build_tools(**context_kwargs):
    from services.contract_agent.graph.state import AgentContext, AgentRunState
    from services.contract_agent.graph.tools.langchain_tools import build_langchain_tools

    state = AgentRunState(
        user_id="u",
        message="what is in this contract?",
        context=AgentContext(**context_kwargs),
    )
    return {tool.name: tool for tool in build_langchain_tools(state=state)}, state


def system_prompt() -> str:
    from services.contract_agent.system_prompt import build_adaptive_system_prompt

    tools, _ = build_tools()
    return build_adaptive_system_prompt(
        tools=list(tools.values()),
        message="Give me a summary of this whole contract.",
        document_count=1,
        attached_documents=[{"document_id": "doc-1", "filename": "Agreement.md"}],
    )


# ── The regex is gone ─────────────────────────────────────────────────────────


def test_repair_follow_up_tool_choice_no_longer_exists():
    from services.contract_agent.graph import react_runtime
    from services.contract_agent.graph.react_runtime import ContractReActRuntime

    assert not hasattr(ContractReActRuntime, "_repair_follow_up_tool_choice")
    source = __import__("inspect").getsource(react_runtime)
    assert "tool_choice_repaired" not in source, (
        "the trace event for the removed rewrite should be gone too"
    )


def test_the_model_chosen_tool_is_executed_unchanged():
    """The behavior the regex broke: a whole-contract question where the model
    picks search_evidence must actually call search_evidence. Overriding it
    server-side made the loop unobservable — the model got evidence it never
    asked for and could not learn from the correction."""
    from langchain_core.messages import AIMessage

    from services.contract_agent.graph.react_runtime import ContractReActRuntime
    from services.contract_agent.graph.state import (
        AgentContext,
        AgentRunState,
        AgentSurface,
    )

    executed = []

    def executor(record, state):
        executed.append((record.name, dict(record.args)))
        return {"summary": "ok", "matches": []}

    class Model:
        def __init__(self):
            self.calls = 0

        def bind_tools(self, tools):
            return self

        def invoke(self, messages):
            self.calls += 1
            if self.calls == 1:
                return AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "search_evidence",
                            "args": {"query": "contract overview"},
                            "id": "c1",
                            "type": "tool_call",
                        }
                    ],
                )
            return AIMessage(content="Here is the overview.")

    state = AgentRunState(
        user_id="u",
        # Matches every trigger the deleted regex looked for.
        message="Give me a summary of this whole contract.",
        context=AgentContext(
            surface=AgentSurface.CONTRACT,
            contract_id="doc-1",
            selected_document_ids=["doc-1"],
            attached_documents=[{"document_id": "doc-1", "filename": "Agreement.md"}],
        ),
        ai_provider="groq",
    )
    ContractReActRuntime(tool_executor=executor, model=Model(), max_iterations=4).run(state)

    assert executed, "the model's tool call must reach the executor"
    assert executed[0][0] == "search_evidence", (
        f"expected the model's own choice, got {executed[0][0]}"
    )
    assert not any(
        trace.event == "tool_choice_repaired" for trace in state.traces
    )


def test_kpi_follow_up_tool_choice_is_not_rewritten():
    """The other deleted branch: a short follow-up with a KPI topic in memory
    used to have its tool forcibly swapped to get_kpi_context."""
    from langchain_core.messages import AIMessage

    from services.contract_agent.graph.react_runtime import ContractReActRuntime
    from services.contract_agent.graph.state import (
        AgentContext,
        AgentRunState,
        AgentSurface,
    )

    executed = []

    def executor(record, state):
        executed.append(record.name)
        return {"summary": "ok", "matches": []}

    class Model:
        def __init__(self):
            self.calls = 0

        def bind_tools(self, tools):
            return self

        def invoke(self, messages):
            self.calls += 1
            if self.calls == 1:
                return AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "search_evidence",
                            "args": {"query": "service levels"},
                            "id": "c1",
                            "type": "tool_call",
                        }
                    ],
                )
            return AIMessage(content="Listed.")

    state = AgentRunState(
        user_id="u",
        message="List them.",
        context=AgentContext(
            surface=AgentSurface.CONTRACT,
            contract_id="doc-1",
            selected_document_ids=["doc-1"],
        ),
        memory_context="Recent turns:\n- User: are the SLA thresholds in breach?\n- Assistant: the hot meal KPI is in breach.",
        ai_provider="groq",
    )
    ContractReActRuntime(tool_executor=executor, model=Model(), max_iterations=4).run(state)

    assert executed == ["search_evidence"]


# ── The intent now lives in the tool surface ──────────────────────────────────


def test_unified_tool_surface_has_twelve_tools_and_no_retired_wrappers():
    from services.contract_agent.graph.tools.registry import (
        APPROVAL_REQUIRED_TOOLS,
        READ_ONLY_TOOLS,
        tool_specs,
    )

    tools, _ = build_tools()
    expected = {
        "calculate_from_evidence",
        "correct_fact",
        "extract_kpis",
        "generate_tabular_review",
        "get_kpi_context",
        "list_documents",
        "project_memory",
        "propose_tabular_review",
        "read_document",
        "remember_fact",
        "replicate_document",
        "search_evidence",
    }

    assert set(tools) == expected
    assert len(tools) == 12
    assert READ_ONLY_TOOLS == {
        "calculate_from_evidence", "get_kpi_context", "list_documents",
        "project_memory", "read_document", "search_evidence",
    }
    assert APPROVAL_REQUIRED_TOOLS == {
        "correct_fact", "extract_kpis", "generate_tabular_review",
        "propose_tabular_review", "remember_fact", "replicate_document",
    }
    assert set(tool_specs()) == expected
    assert not ({
        "fetch_documents", "find_in_document", "outline_document",
        "get_project_timeline", "read_project_concept", "read_project_events",
        "create_tabular_review", "suggest_tabular_review",
    } & set(tools))


def test_unified_read_tool_descriptions_carry_the_selection_intent():
    """The compact prompt delegates tool arbitration to the schemas themselves."""
    tools, _ = build_tools()
    description = tools["read_document"].description.lower()

    assert "coverage" in description
    assert "outline" in description
    assert "full" in description
    assert "search_evidence" in description
    assert "clause" in description
    assert "exact" in tools["search_evidence"].description.lower()
    assert "index" in tools["project_memory"].description.lower()


@pytest.mark.parametrize(
    ("tool_name", "tool_args", "executor_name", "executor_args", "public_args"),
    [
        (
            "read_document",
            {"document_id": "doc-1", "mode": "outline"},
            "outline_document",
            {"document_id": "doc-1", "include_full": False, "max_chars": 50000},
            {"document_id": "doc-1", "mode": "outline", "max_chars": 50000},
        ),
        (
            "project_memory",
            {"view": "events", "limit": 5},
            "read_project_events",
            {"limit": 5},
            {"view": "events", "limit": 5},
        ),
        (
            "search_evidence",
            {"exact": "Section 4"},
            "search_evidence",
            {"query": "Section 4", "must_contain": ["Section 4"]},
            {"exact": "Section 4", "top_k": 12},
        ),
    ],
)
def test_unified_wrappers_keep_public_trace_and_translate_for_executor(
    tool_name, tool_args, executor_name, executor_args, public_args,
):
    executed = []

    def executor(record, state):
        executed.append((record.name, record.args))
        return {"summary": "ok"}

    tools, state = build_tools()
    # Rebuild with the fixture executor while retaining the same hermetic state.
    from services.contract_agent.graph.tools.langchain_tools import build_langchain_tools
    tools = {tool.name: tool for tool in build_langchain_tools(state=state, tool_executor=executor)}

    tools[tool_name].invoke(tool_args)

    assert executed and executed[0][0] == executor_name
    for key, value in executor_args.items():
        assert executed[0][1][key] == value
    for key, value in public_args.items():
        assert state.tools[0].args[key] == value


# ── And in the prompt ─────────────────────────────────────────────────────────


def test_prompt_tool_usage_is_four_compact_lines():
    prompt = system_prompt()
    usage_section = prompt.split("## Tool usage", 1)[1].split("\n## ", 1)[0]
    usage_lines = [line for line in usage_section.splitlines() if line.strip()]

    assert len(usage_lines) == 4
    assert "Coverage vs retrieval" not in usage_section
    assert "outline_document" not in usage_section
    assert "find_in_document" not in usage_section


def test_prompt_tells_the_model_how_to_resolve_a_short_follow_up():
    """Replaces the deleted KPI regex branch: resolve the reference from memory,
    then choose the tool for the resolved question."""
    prompt = system_prompt()
    assert "resolve follow-ups" in prompt.lower()
    assert "get_kpi_context" in prompt


def test_per_turn_user_message_no_longer_restates_routing_policy():
    """The rule used to appear in the system prompt, the tool description, AND
    every user message. Three copies to keep in sync is how they drift."""
    from services.contract_agent.graph.react_runtime import ContractReActRuntime
    from services.contract_agent.graph.state import AgentContext, AgentRunState

    state = AgentRunState(
        user_id="u",
        message="Summarize the whole contract.",
        context=AgentContext(contract_id="doc-1", selected_document_ids=["doc-1"]),
    )
    message = ContractReActRuntime()._build_user_message(state)

    assert "mode=outline" not in message
    assert "read_document" not in message
    # The parts that are genuinely per-turn must survive.
    assert "Summarize the whole contract." in message
    assert "Authorized scope:" in message
