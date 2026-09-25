"""Deterministic tool definitions used by policies and traces."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Literal


ToolRisk = Literal["read_only", "approval_required", "forbidden"]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    risk: ToolRisk
    description: str


READ_ONLY_TOOLS = {
    "calculate_from_evidence",
    "get_kpi_context",
    "list_documents",
    "project_memory",
    "read_document",
    "read_schedules",
    "search_evidence",
}

APPROVAL_REQUIRED_TOOLS = {
    "extract_kpis",
    "generate_tabular_review",
    "remember_fact",
    "correct_fact",
    "propose_tabular_review",
    "replicate_document",
}

# The platform's lifecycle tools (services/assistant/lifecycle.py): thin calls
# into the lifecycle API, bound to the caller's org. Reads run freely; writes
# never execute — they return a proposal the user applies from the chat, which
# is the lifecycle API's own approval gate (routes/agent-threads.ts).
LIFECYCLE_READ_TOOLS = frozenset({
    "contract_get", "contract_search", "contract_filter", "contract_summarize", "clause_search",
    "playbook_check", "redline_propose", "contract_cite", "portfolio_search", "portfolio_compare",
    "counterparty_memory", "contract_validate", "approval_list", "counterparty_get",
    "counterparty_list", "request_list", "custom_field_list", "org_memory", "obligations_list",
    "renewal_advice", "space_list", "compliance_get", "user_search", "template_list",
})
LIFECYCLE_WRITE_TOOLS = frozenset({
    "comment_add", "contract_update", "request_create", "approval_route", "redline_apply",
    "approval_decide", "contract_create_from_template",
})
LIFECYCLE_TOOLS = LIFECYCLE_READ_TOOLS | LIFECYCLE_WRITE_TOOLS

# Forbidden tools are never callable by the agent. They exist as documentation
# of actions the system will always reject, enforced by ActiveMiddlewareEngine.
# send_email              — Forbidden external communication.
# send_external_notice    — Forbidden external notice delivery.
# mutate_source_contract  — Forbidden mutation of source contract records.
# apply_redline_to_original — Forbidden mutation of original source contract.
FORBIDDEN_TOOL_NAMES = frozenset({
    "send_email",
    "send_external_notice",
    "mutate_source_contract",
    "apply_redline_to_original",
})


def tool_specs() -> Dict[str, ToolSpec]:
    descriptions = {
        "calculate_from_evidence": "Evaluate arithmetic using only values found in cited evidence or KPI context.",
        "get_kpi_context": "Retrieve KPI/SLA targets, actuals, breach state, and operational context matching the user query.",
        "list_documents": "List scoped indexed documents, or fetch metadata for a named subset by ID.",
        "project_memory": "Read the project index, one document overview, recent project events, which documents are currently in force and which have been superseded (view=governing), or where documents that all still govern disagree (view=conflicts); it is context, not clause evidence.",
        "read_document": "Read one scoped document in outline, excerpt, or full mode; use full for coverage-sensitive review.",
        "read_schedules": (
            "THE ONLY tool that can compare rates across document versions. "
            "view=list names the tracked schedules; view=values reads a schedule's "
            "actual rates now or on a past date; view=history reads what changed "
            "between versions; view=escalation checks every measured rate movement "
            "against the increase the contract actually permits. "
            "Required for: whether an uplift was honoured, applied, allowed, "
            "correct, or a breach; whether rates rose more than the contract "
            "permits; what a rate is now or used to be; how much a rate has moved. "
            "search_evidence and read_document CANNOT answer these — they return "
            "one version's table with nothing to say whether it is still in force, "
            "and no way to compare it against another version or against a clause."
        ),
        "search_evidence": "Search scoped contracts for clause evidence, or locate an exact phrase with exact=.",
        "extract_kpis": "Extract draft KPI/SLA candidates for a scoped ingested contract only after human approval.",
        "generate_tabular_review": "Generate tabular review cells only after human approval.",
        "propose_tabular_review": "Propose an editable tabular review only after human approval.",
        "replicate_document": "Replicate a document to another project only after human approval.",
        "remember_fact": "Record a durable fact about this project in memory, only after human approval. Propose it whenever the user volunteers a fact worth keeping (a business context, decision, preference, or correction), even if they never say 'remember' or 'save' — most users won't. Do not use it to log routine conversation. A fact taken from a contract must carry the document id and the quote supporting it.",
        "correct_fact": "Correct an existing project fact by recording the replacement and superseding the old fact, only after human approval.",
    }
    specs: Dict[str, ToolSpec] = {}
    for name in sorted(READ_ONLY_TOOLS):
        specs[name] = ToolSpec(name=name, risk="read_only", description=descriptions.get(name, "Read scoped ContractSense data."))
    for name in sorted(APPROVAL_REQUIRED_TOOLS):
        specs[name] = ToolSpec(name=name, risk="approval_required", description=descriptions.get(name, "Side-effecting action requiring human approval."))
    return specs
