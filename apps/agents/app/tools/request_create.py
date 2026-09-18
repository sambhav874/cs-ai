"""request_create — write tool (plan-then-execute).

Proposes a new contract intake request. Returns an awaiting-confirmation
payload; on Apply the thread RPC dispatches to
/api/internal/ai/tools/request_create with orgId/requestedById enforced
from the JWT. Arg keys match that endpoint's schema (source is
hard-coded to 'chat' server-side).
"""
from __future__ import annotations

from typing import Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


class RequestCreateArgs(BaseModel):
    title:             str = Field(..., min_length=1, max_length=200, description="Short request title, e.g. 'NDA with Initech'.")
    type:              str = Field(..., description="Contract type enum: NDA, MSA, SOW, SLA, VENDOR_AGREEMENT, EMPLOYMENT, PARTNERSHIP, LICENSE, DATA_PROCESSING, ORDER_FORM, OTHER.")
    description:       str = Field(..., min_length=1, max_length=5000, description="What's needed and why — context for the legal team.")
    counterparty_name: str | None = Field(None, max_length=200, description="Counterparty name if known.")
    estimated_value:   float | None = Field(None, ge=0, description="Estimated contract value in org currency, if known.")
    priority:          Literal["LOW", "MEDIUM", "HIGH", "URGENT"] = Field("MEDIUM", description="Request priority.")


def build_request_create(_org_id: str, _user_id: str | None = None) -> StructuredTool:
    async def _arun(
        title: str,
        type: str,  # noqa: A002 — matches endpoint key
        description: str,
        counterparty_name: str | None = None,
        estimated_value: float | None = None,
        priority: str = "MEDIUM",
    ) -> dict:
        args: dict = {
            "title":       title,
            "type":        type,
            "description": description,
            "priority":    priority,
        }
        if counterparty_name:
            args["counterpartyName"] = counterparty_name
        if estimated_value is not None:
            args["estimatedValue"] = estimated_value
        cp = f" with {counterparty_name}" if counterparty_name else ""
        return {
            "awaitingConfirmation": True,
            "args": args,
            "preview": {
                "summary": f"Create a {type} intake request{cp}: “{title}”",
                "target": title,
            },
            "reversible": True,
        }

    def _run(title, type, description, counterparty_name=None, estimated_value=None, priority="MEDIUM"):  # noqa: A002
        import asyncio
        return asyncio.run(_arun(title, type, description, counterparty_name, estimated_value, priority))

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="request_create",
        description=(
            "Propose creating a contract intake request (routed to the legal "
            "queue). The user confirms via an Apply card before the request "
            "is created. Use when asked to 'request an NDA for X' or 'kick "
            "off a new contract with Y'."
        ),
        args_schema=RequestCreateArgs,
    )
