"""contract_filter — structured portfolio filters contract_search does not have.

Replaces the retired portfolio agent's natural-language filter parsing: the
assistant reads "vendors with an MFN clause governed by California law,
expiring before 2027" and calls this with the fields; the lifecycle API
applies them and counts (/api/internal/ai/tools/contract_filter).
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ..config import settings

log = logging.getLogger(__name__)

CLAUSE_FLAGS = (
    "forceMajeure", "mfn", "changeOfControl", "auditRights", "assignmentRestriction",
    "limitationOfLiability", "indemnification", "warrantyDisclaimer",
)


class ContractFilterArgs(BaseModel):
    type: Optional[str] = Field(None, description="Contract type, e.g. NDA, MSA, SOW, VENDOR_AGREEMENT.")
    status: Optional[str] = Field(None, description="Lifecycle status, e.g. EXECUTED, DRAFT, EXPIRED.")
    counterparty_name: Optional[str] = Field(None, description="Counterparty name (substring match).")
    jurisdiction: Optional[str] = Field(None, description="Governing law / jurisdiction (substring match), e.g. 'California'.")
    risk_min: Optional[float] = Field(None, ge=0, le=1, description="Minimum risk score, 0-1.")
    risk_max: Optional[float] = Field(None, ge=0, le=1, description="Maximum risk score, 0-1.")
    expiry_from: Optional[str] = Field(None, description="Expiry on or after this date (YYYY-MM-DD).")
    expiry_to: Optional[str] = Field(None, description="Expiry on or before this date (YYYY-MM-DD).")
    effective_from: Optional[str] = Field(None, description="Effective on or after this date (YYYY-MM-DD).")
    effective_to: Optional[str] = Field(None, description="Effective on or before this date (YYYY-MM-DD).")
    clause_flags: Optional[dict[str, bool]] = Field(
        None, description=f"Clause presence, e.g. {{\"mfn\": true}}. Keys: {', '.join(CLAUSE_FLAGS)}.",
    )
    limit: int = Field(25, ge=1, le=50, description="Max contracts listed (the count covers all matches).")


_KEYS = {
    "type": "type", "status": "status", "counterparty_name": "counterpartyName", "jurisdiction": "jurisdiction",
    "risk_min": "riskMin", "risk_max": "riskMax", "expiry_from": "expiryFrom", "expiry_to": "expiryTo",
    "effective_from": "effectiveFrom", "effective_to": "effectiveTo", "clause_flags": "clauseFlags",
}


def build_contract_filter(org_id: str) -> StructuredTool:
    async def _arun(limit: int = 25, **filters) -> str:
        payload: dict = {"orgId": org_id, "limit": limit}
        for key, value in filters.items():
            if value is not None and key in _KEYS:
                payload[_KEYS[key]] = value
        url = f"{settings.api_url.rstrip('/')}/api/internal/ai/tools/contract_filter"
        headers = {
            "x-internal-secret": settings.internal_service_secret,
            "x-internal-service": "agents",
            "content-type": "application/json",
        }
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            r = await client.post(url, json=payload, headers=headers)
        if r.status_code >= 400:
            log.warning("[contract_filter] Node returned %s: %s", r.status_code, r.text[:200])
            return '{"error":"contract_filter_failed","status":' + str(r.status_code) + "}"
        return r.text

    def _run(**kwargs):
        import asyncio
        return asyncio.run(_arun(**kwargs))

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="contract_filter",
        description=(
            "Filter the org's contracts by governing law, risk range, clause flags (MFN, change of control, "
            "audit rights...), effective/expiry date ranges, type, status and counterparty. Returns "
            "totalMatching (the real count) and up to `limit` contracts. Use for 'how many NDAs expire in "
            "the next 90 days', 'vendors with an MFN clause under California law'. Compute dates yourself "
            "from today's date; pass them as YYYY-MM-DD."
        ),
        args_schema=ContractFilterArgs,
    )
