"""The no-executor fallback must enforce the same scope as the real executor.

_default_read_observation used to ignore the requested document id entirely.
Asking read_document for an out-of-scope id returned the IN-SCOPE document with
a success summary — no denial. And with two documents in scope, asking for the
second returned the first. Either way the model asked for X, received Y, and was
told it worked, which is how a confidently mis-cited answer gets made.

EV-NF-12 in final_evaluation covers the out-of-scope case; this file adds the
in-scope substitution case and pins both at the unit level.
"""
from pathlib import Path
import sys

INTELLIGENCE = Path(__file__).resolve().parents[3] / "apps" / "intelligence"
if str(INTELLIGENCE) not in sys.path:
    sys.path.insert(0, str(INTELLIGENCE))

from services.contract_agent.graph import AgentContext, AgentRunState  # noqa: E402
from services.contract_agent.graph.tools.langchain_tools import build_langchain_tools  # noqa: E402

DOC_A = "507f1f77bcf86cd799439011"
DOC_B = "507f1f77bcf86cd799439012"


def _read_tool(selected):
    state = AgentRunState(
        user_id="user-1",
        message="read",
        context=AgentContext(surface="contract", contract_id=selected[0], selected_document_ids=selected),
    )
    return next(t for t in build_langchain_tools(state=state) if t.name == "read_document")


def test_out_of_scope_id_is_denied_not_substituted():
    # A denial reaches the model as a structured observation, not a raised
    # exception: run_read_tool converts non-retryable tool errors so the agent
    # can say "not in scope" instead of the whole run crashing. What matters is
    # that it is a DENIAL — before the fix this returned a success summary and
    # DOC_A's id.
    out = _read_tool([DOC_A]).invoke({"document_id": "unauthorized-doc-789"})
    assert out["error"]["kind"] == "out_of_scope"
    assert out.get("document_id") != DOC_A


def test_in_scope_request_returns_the_document_asked_for():
    out = _read_tool([DOC_A, DOC_B]).invoke({"document_id": DOC_B})
    assert out["document_id"] == DOC_B


def test_no_id_named_still_falls_back_to_context():
    out = _read_tool([DOC_A]).invoke({})
    assert out["document_id"] == DOC_A
