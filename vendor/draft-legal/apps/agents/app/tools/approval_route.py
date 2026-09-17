"""approval_route — write tool (plan-then-execute).

Proposes routing a contract into its approval workflow. Returns an
awaiting-confirmation payload; on Apply the thread RPC dispatches to
/api/internal/ai/tools/approval_route (orgId/userId enforced from the
JWT). The endpoint auto-selects a matching active workflow when no
explicit workflowDefinitionId is given, honouring auto-approve rules.
"""
from __future__ import annotations

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


class ApprovalRouteArgs(BaseModel):
    contract_id: str = Field(..., description="Contract CUID to submit for approval (must be DRAFT / PENDING_REVIEW / UNDER_NEGOTIATION).")
    workflow_definition_id: str | None = Field(
        None,
        description="Optional explicit workflow id; omit to auto-select the org's matching active workflow.",
    )
    comment: str | None = Field(None, max_length=2000, description="Optional note for the approvers.")


def build_approval_route(_org_id: str, _user_id: str | None = None) -> StructuredTool:
    async def _arun(contract_id: str, workflow_definition_id: str | None = None, comment: str | None = None) -> dict:
        args: dict = {"contractId": contract_id}
        if workflow_definition_id:
            args["workflowDefinitionId"] = workflow_definition_id
        if comment:
            args["comment"] = comment
        wf = " using the specified workflow" if workflow_definition_id else " (auto-selecting the matching workflow)"
        return {
            "awaitingConfirmation": True,
            "args": args,
            "preview": {
                "summary": f"Submit this contract for approval{wf}",
                "contractId": contract_id,
            },
            "reversible": True,
        }

    def _run(contract_id: str, workflow_definition_id: str | None = None, comment: str | None = None) -> dict:
        import asyncio
        return asyncio.run(_arun(contract_id, workflow_definition_id, comment))

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="approval_route",
        description=(
            "Propose submitting a contract into its approval workflow. The "
            "user confirms via an Apply card before anything changes. Use "
            "when asked to 'send this for approval' / 'route to legal "
            "review'. The contract must be in DRAFT, PENDING_REVIEW, or "
            "UNDER_NEGOTIATION."
        ),
        args_schema=ApprovalRouteArgs,
    )
