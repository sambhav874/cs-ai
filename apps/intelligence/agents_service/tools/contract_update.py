"""contract_update — write tool (plan-then-execute).

Action-shaped operational mutations on a contract. Does NOT call the
backend: returns an awaiting-confirmation payload; the ActionPreview
Apply button routes through /agent/threads/:id/actions/apply →
/api/internal/ai/tools/contract_update (orgId/userId enforced from JWT).

2026-04-29 decision: validate required payload keys per action HERE and
return a structured `missing_payload_keys` error — the LLM was silently
no-op'ing with empty payloads before.
"""
from __future__ import annotations

from typing import Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

_REQUIRED_KEYS: dict[str, list[str]] = {
    "set_status":   ["status"],
    "assign_owner": ["ownerId"],
    "add_tag":      ["tag"],
    "remove_tag":   ["tag"],
    "retype":       ["type"],
    "re_analyze":   [],
}

# Mirrors internal-ai.ts — retype / re_analyze kick async pipelines and
# can't be rolled back with a single UPDATE.
_REVERSIBLE_ACTIONS = {"set_status", "assign_owner", "add_tag", "remove_tag"}

_SUMMARY: dict[str, str] = {
    "set_status":   "Set status to {status}",
    "assign_owner": "Assign owner to user {ownerId}",
    "add_tag":      "Add tag '{tag}'",
    "remove_tag":   "Remove tag '{tag}'",
    "retype":       "Re-type contract as {type} and re-run extraction",
    "re_analyze":   "Re-run AI analysis",
}


class ContractUpdateArgs(BaseModel):
    contract_id: str = Field(..., description="Contract CUID to update.")
    action: Literal["set_status", "assign_owner", "add_tag", "remove_tag", "retype", "re_analyze"] = Field(
        ...,
        description=(
            "set_status (payload.status: new lifecycle status, must be a valid "
            "transition) · assign_owner (payload.ownerId: user CUID) · "
            "add_tag/remove_tag (payload.tag) · retype (payload.type: contract "
            "type enum) · re_analyze (no payload)."
        ),
    )
    payload: dict = Field(default_factory=dict, description="Per-action payload — see action description for required keys.")


def build_contract_update(_org_id: str, _user_id: str | None = None) -> StructuredTool:
    async def _arun(contract_id: str, action: str, payload: dict | None = None) -> dict:
        payload = payload or {}
        missing = [k for k in _REQUIRED_KEYS.get(action, []) if payload.get(k) in (None, "")]
        if missing:
            # Structured error — the LLM retries with the keys filled instead
            # of claiming success on a no-op.
            return {
                "error": "missing_payload_keys",
                "action": action,
                "missing_payload_keys": missing,
                "hint": f"Re-call contract_update with payload containing: {', '.join(missing)}",
            }
        try:
            summary = _SUMMARY[action].format(**{k: payload.get(k) for k in _REQUIRED_KEYS.get(action, [])})
        except (KeyError, IndexError):
            summary = f"Run {action}"
        return {
            "awaitingConfirmation": True,
            "args": {"contractId": contract_id, "action": action, "payload": payload},
            "preview": {
                "summary": f"{summary} on this contract",
                "contractId": contract_id,
            },
            "reversible": action in _REVERSIBLE_ACTIONS,
        }

    def _run(contract_id: str, action: str, payload: dict | None = None) -> dict:
        import asyncio
        return asyncio.run(_arun(contract_id, action, payload))

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="contract_update",
        description=(
            "Propose an operational update on a contract: set_status, "
            "assign_owner, add_tag, remove_tag, retype, or re_analyze. The "
            "user confirms via an Apply card before anything changes. "
            "Required arguments must be present — if the user already asked "
            "for the change in this turn, fire this tool (don't re-ask)."
        ),
        args_schema=ContractUpdateArgs,
    )
