"""Tabular review tool payload helpers."""

from __future__ import annotations

from typing import Any, Dict, List

from ..state import TabularColumnProposal, TabularReviewProposal


def _tabular_columns_payload(columns: List[TabularColumnProposal]) -> List[Dict[str, Any]]:
    return [column.model_dump(mode="json") for column in columns]


def _tabular_proposal_payload(proposal: TabularReviewProposal) -> Dict[str, Any]:
    payload = proposal.model_dump(mode="json")
    payload["columns_config"] = _tabular_columns_payload(proposal.columns_config)
    return payload
