"""Approval and editable proposal handling for side-effecting workflows."""

from __future__ import annotations

from typing import Any, Dict

from .state import ApprovalRequest, TabularReviewProposal


class ApprovalManager:
    def tool_request(self, *, workflow_id: str, action: str, payload: Dict[str, Any]) -> ApprovalRequest:
        description = str(
            payload.get("message")
            or f"Review and approve before ContractSense performs '{action}'."
        )
        title = f"Approve {action.replace('_', ' ')}"
        if action == "extract_kpis":
            title = "Extract KPIs from contract"
            description = "Approve before ContractSense creates or replaces draft KPI/SLA candidates for this contract."
        return ApprovalRequest(
            workflow_id=workflow_id,
            action=action,  # type: ignore[arg-type]
            title=title,
            description=description,
            payload={
                "idempotency_key": f"{workflow_id}:{action}",
                **(payload.get("params") if isinstance(payload.get("params"), dict) else {}),
            },
        )

    def tabular_request(self, *, workflow_id: str, proposal: TabularReviewProposal) -> ApprovalRequest:
        return ApprovalRequest(
            workflow_id=workflow_id,
            action="create_tabular_review",
            title=f"Create tabular review: {proposal.title}",
            description=(
                "Review the proposed documents and fields. You can edit, add, remove, "
                "or reorder fields before approval."
            ),
            tabular_review=proposal,
            payload={"idempotency_key": f"{workflow_id}:create_tabular_review"},
        )

    def apply_tabular_patch(
        self,
        proposal: TabularReviewProposal,
        patch: Dict[str, Any],
    ) -> TabularReviewProposal:
        payload = proposal.model_dump()
        for key in ["title", "project_id", "document_ids", "columns_config", "practice_area"]:
            if key in patch:
                payload[key] = patch[key]
        if "columns_config" in payload:
            payload["columns_config"] = self._reindex_columns(payload["columns_config"])
        next_proposal = TabularReviewProposal.model_validate(payload)
        next_proposal.estimated_rows = len(next_proposal.document_ids)
        next_proposal.estimated_columns = len(next_proposal.columns_config)
        return next_proposal

    def _reindex_columns(self, columns: Any) -> list[dict[str, Any]]:
        normalized = []
        for index, raw_column in enumerate(columns or []):
            column = dict(raw_column)
            column["index"] = index
            normalized.append(column)
        return normalized
