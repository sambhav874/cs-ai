"""Scope-gate tests for every document selector shape accepted by the tools."""

from __future__ import annotations

import pytest

from services.contract_agent.graph.middleware import UnauthorizedAccessError
from services.contract_agent.graph.state import AgentContext, AgentRunState, ToolCallRecord
from services.contract_agent.graph.tools.executor import _restrict_documents, execute_mongo_read_tool
from services.contract_agent.graph.tools.langchain_tools import ProjectMemoryInput


class FakeCollection:
    def __init__(self, documents):
        self.documents = documents

    def find(self, query, projection=None):
        del projection
        wanted = {str(value) for value in query["_id"]["$in"]}
        return [document for document in self.documents if str(document["_id"]) in wanted]


def make_state(**context_kwargs):
    defaults = {
        "selected_document_ids": ["doc-1"],
        "reference_contract_ids": ["doc-2"],
        "contract_id": "doc-1",
    }
    defaults.update(context_kwargs)
    return AgentRunState(
        user_id="user-1",
        message="Find the payment term.",
        context=AgentContext(**defaults),
    )


@pytest.mark.parametrize(
    ("tool_name", "args"),
    [
        ("read_document", {"document_id": "doc-forbidden"}),
        ("search_evidence", {"document_ids": ["doc-1", "doc-forbidden"]}),
        ("get_kpi_context", {"contract_id": "doc-forbidden"}),
    ],
)
def test_scope_gate_rejects_each_id_argument_shape(tool_name, args):
    state = make_state()
    tool = ToolCallRecord(name=tool_name, args=args)
    documents = [
        {"_id": "doc-1", "index": {"status": "success", "content": "payment"}},
        {"_id": "doc-2", "index": {"status": "success", "content": "payment"}},
    ]

    with pytest.raises(UnauthorizedAccessError, match="doc-forbidden"):
        execute_mongo_read_tool(FakeCollection(documents), tool, state)


def test_scope_gate_keeps_authorized_reference_documents_available():
    state = make_state()
    documents = [
        {"_id": "doc-1", "index": {"status": "success", "content": "one"}},
        {"_id": "doc-2", "index": {"status": "success", "content": "two"}},
    ]
    tool = ToolCallRecord(name="list_documents", args={"document_ids": ["doc-2"]})

    result = _restrict_documents(documents, tool, state)

    assert [document["_id"] for document in result] == ["doc-2"]


def test_project_memory_schema_does_not_advertise_ignored_project_id():
    assert "project_id" not in ProjectMemoryInput.model_fields
