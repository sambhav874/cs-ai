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
        "project_memory": "Read the project index, one document overview, recent project events, or which documents are currently in force and which have been superseded (view=governing); it is context, not clause evidence.",
        "read_document": "Read one scoped document in outline, excerpt, or full mode; use full for coverage-sensitive review.",
        "read_schedules": "Read the project's tracked rate schedules across document versions: list them, read the current or a past version's actual rates, or read what changed between versions. Use this for any question about what a rate is now, what it used to be, or how much it has moved — searching the documents returns one version's table with no way to tell whether it is the one still in force.",
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
