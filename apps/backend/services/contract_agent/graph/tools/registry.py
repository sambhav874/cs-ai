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
    "get_project_timeline",
    "list_documents",
    "outline_document",
    "read_document",
    "read_project_concept",
    "read_project_events",
    "search_evidence",
}

APPROVAL_REQUIRED_TOOLS = {
    "create_tabular_review",
    "extract_kpis",
    "generate_tabular_review",
    "remember_fact",
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
        "get_project_timeline": "Retrieve project memory: the complete list of documents in this project with how they relate to each other, plus any recorded facts and team notes. Use this before assuming what a project does or does not contain.",
        "read_project_concept": "Read one document's full project-memory overview by its document id, as listed in the project index. Use when the index line is not enough detail.",
        "read_project_events": "Read the recent history of what has happened in this project — documents ingested, amendments detected, facts recorded.",
        "list_documents": "List scoped indexed documents available to this agent run.",
        "outline_document": "Read a document outline or high-level structure.",
        "read_document": "Read a focused excerpt, or the full indexed document when include_full is enabled for whole-contract summaries.",
        "search_evidence": "Search scoped contracts and return clause-level evidence with quote, context, page, section, score, and evidence ID.",
        "create_tabular_review": "Create a tabular review only after human approval.",
        "extract_kpis": "Extract draft KPI/SLA candidates for a scoped ingested contract only after human approval.",
        "generate_tabular_review": "Generate tabular review cells only after human approval.",
        "replicate_document": "Replicate a document to another project only after human approval.",
        "suggest_tabular_review": "Suggest an editable tabular review column configuration for human approval.",
        "remember_fact": "Record a durable fact about this project in memory, only after human approval. Use only when the user explicitly asks for something to be remembered — not to log the conversation. A fact taken from a contract must carry the document id and the quote supporting it.",
    }
    specs: Dict[str, ToolSpec] = {}
    for name in sorted(READ_ONLY_TOOLS):
        specs[name] = ToolSpec(name=name, risk="read_only", description=descriptions.get(name, "Read scoped ContractSense data."))
    for name in sorted(APPROVAL_REQUIRED_TOOLS):
        specs[name] = ToolSpec(name=name, risk="approval_required", description=descriptions.get(name, "Side-effecting action requiring human approval."))
    return specs
