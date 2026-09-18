import os
import pytest

# Ensure required environment variables for the agent engine are set
os.environ.setdefault("HUGGINGFACE_TOKEN", "test-operational")
os.environ.setdefault("GROQ_API_KEY", "test-operational")
os.environ.setdefault("FINAL_OUTPUT_DIR", "/tmp/extractor-test-output")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/test")

from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import BaseTool
import uuid

from services.contract_agent.graph.runner import DeepContractAgentRunner
from services.contract_agent.graph import AgentContext, AgentRunState, AgentStatus
from final_evaluation.tests.conftest import run_agent_traceable, ls_client


class ToolCallingFakeModel(FakeMessagesListChatModel):
    """A fake chat model that supports tool binding for testing."""
    def bind_tools(self, tools, **kwargs):
        object.__setattr__(self, "bound_tool_names", [tool.name for tool in tools if isinstance(tool, BaseTool)])
        return self


def test_agent_engine_starts_cleanly():
    """
    EV-OP-01: Engine Initialization & Recovery
    Category: Operational | Pillar: Reliability | Tier: Sanity
    The system initializes the core Contract Guardian engine during startup.
    Asserts that the DeepContractAgentRunner instantiates without any configuration errors.
    """
    runner = DeepContractAgentRunner()
    
    assert runner is not None
    assert isinstance(runner, DeepContractAgentRunner)


def test_new_session_is_clean():
    """
    EV-OP-02: Session Memory State Reset
    Category: Operational | Pillar: Reliability | Tier: Sanity
    A user opens a brand new chat window.
    Asserts the session starts with a completely empty memory and the correct 'started' status.
    """
    state = AgentRunState(
        user_id="user-ops-test",
        message="init",
    )
    
    # State initializes to STARTED
    assert state.status == AgentStatus.STARTED
    # A fresh context is completely empty
    assert state.context.contract_id is None
    assert state.context.project_id is None
    assert state.context.selected_document_ids == []
    # No tools executed yet
    assert state.tools == []


def test_simple_chat_message_completes_without_error():
    """
    EV-OP-03: Basic API Connectivity Handshake
    Category: Operational | Pillar: Reliability | Tier: Sanity
    A user sends a simple "Hello" message to the agent.
    Asserts the agent processes the input and returns a valid text response without crashing.
    """
    state = AgentRunState(
        user_id="user-ops-test",
        message="Hello",
        context=AgentContext(surface="contract", contract_id="doc-123"),
    )

    # Mock the LLM to simply say hello back
    mock_llm = ToolCallingFakeModel(
        responses=[AIMessage(content="Hello! I am Contract Guardian. How can I help you today?")]
    )
    
    runner = DeepContractAgentRunner(model=mock_llm)
    
    run_id = str(uuid.uuid4())
    response = run_agent_traceable(
        runner, 
        state, 
        langsmith_extra={"run_id": run_id}
    )
    
    # Assert successful completion
    assert response.workflow_status == AgentStatus.COMPLETED
    assert response.answer is not None
    assert "Contract Guardian" in response.answer
    assert "error" not in response.answer.lower()
    
    # Natively log test success feedback to LangSmith
    try:
        ls_client.create_feedback(run_id, key="EV-OP-03-operational-success", score=1.0)
    except Exception as e:
        print(f"Skipping LangSmith feedback due to auth/config: {e}")
