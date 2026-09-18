"""Hermetic tests for the approval-gated project-fact correction path."""

from __future__ import annotations

from typing import Any, List

from langchain_core.messages import AIMessage

from services.agent_memory import AgentMemoryManager
from services.contract_agent.graph.react_runtime import ContractReActRuntime
from services.contract_agent.graph.state import AgentContext, AgentRunState, AgentSurface, ApprovalRequest
from services.contract_agent.graph.tools.langchain_tools import build_langchain_tools
from services.contract_agent.graph.tools.registry import APPROVAL_REQUIRED_TOOLS, tool_specs
from services.memory.summarizer import summarize_run_outcome


class FakeEpisodes:
    def __init__(self):
        self.docs = []

    def insert_one(self, document):
        self.docs.append(document)


def test_correct_fact_is_registered_as_an_approval_gated_tool():
    state = AgentRunState(
        user_id="user-1",
        message="The notice period is 60 days, not 30.",
        context=AgentContext(project_id="project-1", contract_id="doc-1"),
    )
    tools = {tool.name: tool for tool in build_langchain_tools(state=state)}

    assert "correct_fact" in tools
    assert "correct_fact" in APPROVAL_REQUIRED_TOOLS
    assert tool_specs()["correct_fact"].risk == "approval_required"
    assert "human approval" in tools["correct_fact"].description.lower()


def test_approval_tool_returns_a_normal_observation():
    state = AgentRunState(
        user_id="user-1",
        message="Remember that the notice period is 60 days.",
        context=AgentContext(project_id="project-1", contract_id="doc-1"),
    )
    remember_fact = next(tool for tool in build_langchain_tools(state=state) if tool.name == "remember_fact")

    observation = remember_fact.invoke({"text": "Notice period is 60 days.", "origin": "user"})

    assert observation["status"] == "approval_required"
    assert observation["tool"] == "remember_fact"
    assert state.tools[-1].observation["status"] == "approval_required"


class ParallelApprovalModel:
    def __init__(self, response: AIMessage):
        self.response = response
        self.calls = 0

    def bind_tools(self, _tools: List[Any]):
        return self

    def invoke(self, _messages: List[Any]):
        self.calls += 1
        return self.response


def test_parallel_read_finishes_before_approval_boundary():
    model = ParallelApprovalModel(
        AIMessage(
            content="",
            tool_calls=[
                {"name": "search_evidence", "args": {"query": "notice period"}, "id": "search-1", "type": "tool_call"},
                {"name": "remember_fact", "args": {"text": "Notice period is 60 days.", "origin": "user"}, "id": "remember-1", "type": "tool_call"},
            ],
        )
    )
    executed: List[str] = []

    def executor(record, _state):
        executed.append(record.name)
        return {"summary": "Scoped evidence found.", "search_results": "The notice period is 60 days."}

    state = AgentRunState(
        user_id="user-1",
        message="The notice period is 60 days, not 30.",
        context=AgentContext(
            surface=AgentSurface.CONTRACT,
            project_id="project-1",
            contract_id="doc-1",
            selected_document_ids=["doc-1"],
        ),
    )

    result = ContractReActRuntime(tool_executor=executor, model=model, max_iterations=3).run(state)

    assert result.status.value == "waiting_approval"
    assert result.approval_request is not None
    assert result.approval_request.action == "remember_fact"
    assert model.calls == 1
    assert executed == ["search_evidence"]
    assert result.tools[0].observation["search_results"] == "The notice period is 60 days."
    assert [tool.name for tool in result.tools] == ["search_evidence", "remember_fact"]


def test_approval_state_accepts_correct_fact_action():
    request = ApprovalRequest(
        workflow_id="workflow-1",
        action="correct_fact",
        title="Correct project fact",
        description="Review the replacement fact.",
        payload={"fact_id": "fact-1", "text": "Notice is 60 days."},
    )

    assert request.action == "correct_fact"
    assert request.payload["fact_id"] == "fact-1"


def test_correction_episode_is_stored_with_user_correction_context():
    fake = type("Memory", (), {"episodes": FakeEpisodes()})()

    episode = AgentMemoryManager.record_run_episode(
        fake,
        session_id="session-1",
        contract_id="doc-1",
        user_id="user-1",
        project_id="project-1",
        question="The notice period is 60 days, not 30.",
        tools_called=["correct_fact"],
        correction="Notice is 60 days, not 30.",
        workflow_id="workflow-1",
    )

    assert fake.episodes.docs[0] is episode
    assert episode["summary"].endswith("user corrected: Notice is 60 days, not 30.")
    assert "correct_fact" in episode["tools_called"]


def test_run_outcome_keeps_correction_distinct_from_answer_evidence():
    summary = summarize_run_outcome(
        question="The notice period is 60 days, not 30.",
        tools_called=["correct_fact"],
        citation_count=0,
        correction="Notice is 60 days, not 30.",
    )

    assert "uncited" in summary
    assert "user corrected: Notice is 60 days, not 30." in summary
