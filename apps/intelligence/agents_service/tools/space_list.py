"""space_list tool — list spaces in the org with optional filters.

Persona-test fix #1: the agent had no first-class way to answer "what
spaces do I own?" / "what matters are open right now?" — it would
fall back to obligations_list or request_list and return wrong-domain
results. Spaces are how legal teams group related contracts; making
them queryable is core to every persona's daily JTBDs.
"""
from __future__ import annotations
import logging, httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from ..config import settings

log = logging.getLogger(__name__)


class SpaceListArgs(BaseModel):
    owner_id: str | None = Field(
        None,
        description="Filter to spaces owned by this user id. Use the current "
                    "user's id when the user asks 'what matters do I own?'.",
    )
    status: str | None = Field(
        None,
        description="OPEN | CLOSED | ARCHIVED. Default returns all statuses; "
                    "use OPEN for 'what's open right now?'.",
    )
    counterparty_name: str | None = Field(
        None,
        description="Substring filter on the space's primary counterparty "
                    "name (e.g. 'Pfizer' to find the Pfizer collaboration).",
    )
    query: str | None = Field(
        None,
        description="Free-text search on space name + description (e.g. "
                    "'tariff' to find the 2026 Steel Tariff Response space).",
    )
    limit: int = Field(25, ge=1, le=100)


def build_space_list(org_id: str, user_id: str | None = None) -> StructuredTool:
    async def _arun(owner_id=None, status=None, counterparty_name=None,
                    query=None, limit: int = 25) -> str:
        url = f"{settings.api_url.rstrip('/')}/api/internal/ai/tools/space_list"
        headers = {
            "x-internal-secret": settings.internal_service_secret,
            "x-internal-service": "agents",
            "content-type": "application/json",
        }
        payload: dict = {"orgId": org_id, "limit": limit}
        if owner_id:          payload["ownerId"]          = owner_id
        if status:            payload["status"]           = status
        if counterparty_name: payload["counterpartyName"] = counterparty_name
        if query:             payload["query"]            = query
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
            r = await client.post(url, json=payload, headers=headers)
        if r.status_code >= 400:
            log.warning("[space_list] Node %s: %s", r.status_code, r.text[:200])
            return '{"error":"space_list_failed","status":' + str(r.status_code) + "}"
        return r.text

    def _run(owner_id=None, status=None, counterparty_name=None,
             query=None, limit: int = 25):
        import asyncio
        return asyncio.run(_arun(owner_id, status, counterparty_name, query, limit))

    # Pre-bind the current user_id to "me" semantics so the model can
    # answer "what matters do I own?" without having to pass an id.
    description = (
        "List MATTERS (the legal-team grouping unit for related contracts: "
        "M&A deals, hub renewals, pilot programs, compliance reviews). "
        "A space is NOT a contract — it's a folder/workspace that GROUPS "
        "contracts together. Filters: owner_id, status "
        "(OPEN|CLOSED|ARCHIVED), counterparty_name, query.\n\n"
        "USE WHEN the user explicitly asks about 'spaces', 'workspaces', "
        "'cohorts', 'projects', 'rollups', 'campaigns', or names a known "
        "space (e.g. 'Pfizer collaboration', 'Q2 Privacy Review', '2026 "
        "Steel Tariff Response'). Examples:\n"
        "  - 'what matters do I own?'\n"
        "  - 'what's open right now?' (when 'open' modifies 'spaces')\n"
        "  - 'show me the Pfizer collaboration' (named space)\n"
        "  - 'what's the status of the Memphis hub renewal cohort?'\n\n"
        "DO NOT USE for queries about CONTRACTS — those go to contract_search "
        "or portfolio_search. Wrong examples:\n"
        "  - 'how many contracts do I own?' → contract_search\n"
        "  - 'show me Pfizer contracts' → contract_search or counterparty_*\n"
        "  - 'what contracts are expiring?' → renewal_advice\n\n"
        "Returns the space id + name + counterparty + contractCount / "
        "requestCount / threadCount so you can drill in further with "
        "contract_search(query='space name')."
    )
    if user_id:
        description += (
            f"\n\nCurrent user id is {user_id}. Pass owner_id={user_id} when "
            "the user asks for 'my spaces' / 'spaces I own'."
        )

    return StructuredTool.from_function(
        coroutine=_arun, func=_run, name="space_list",
        description=description,
        args_schema=SpaceListArgs,
    )
