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
    "fetch_documents",
    "find_in_document",
    "get_kpi_context",
    "list_documents",
    "outline_document",
    "read_document",
    "search_evidence",
}

APPROVAL_REQUIRED_TOOLS = {
    "create_tabular_review",
    "extract_kpis",
    "generate_tabular_review",
    "replicate_document",
    "suggest_tabular_review",
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
        "fetch_documents": "Fetch scoped indexed document metadata by IDs.",
        "find_in_document": "Locate an exact phrase, clause reference, or keyword inside one scoped document.",
        "get_kpi_context": "Retrieve KPI/SLA targets, actuals, breach state, and operational context matching the user query.",
        "list_documents": "List scoped indexed documents available to this agent run.",
        "outline_document": "Read a document outline or high-level structure.",
        "read_document": "Read an excerpt from the current or requested scoped document.",
        "search_evidence": "Search scoped contracts and return clause-level evidence with quote, context, page, section, score, and evidence ID.",
        "create_tabular_review": "Create a tabular review only after human approval.",
        "extract_kpis": "Extract draft KPI/SLA candidates for a scoped ingested contract only after human approval.",
        "generate_tabular_review": "Generate tabular review cells only after human approval.",
        "replicate_document": "Replicate a document to another project only after human approval.",
        "suggest_tabular_review": "Suggest an editable tabular review column configuration for human approval.",
    }
    specs: Dict[str, ToolSpec] = {}
    for name in sorted(READ_ONLY_TOOLS):
        specs[name] = ToolSpec(name=name, risk="read_only", description=descriptions.get(name, "Read scoped ContractSense data."))
    for name in sorted(APPROVAL_REQUIRED_TOOLS):
        specs[name] = ToolSpec(name=name, risk="approval_required", description=descriptions.get(name, "Side-effecting action requiring human approval."))
    return specs
