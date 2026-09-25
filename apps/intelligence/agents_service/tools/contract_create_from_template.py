"""contract_create_from_template — draft a contract, for the user to create.

Drafts with the draft agent (agents/draft_agent.py): it reads the request,
picks the org's best-fit template, fills the template's variables from what
the user said, and reports what it could not fill. Nothing is written: the
draft comes back as an Apply card with the rendered preview, and Apply
creates the Contract + ContractVersion through the lifecycle API's
/api/internal/ai/tools/contract_create_from_template (routes/agent-threads.ts
checks create:contract first).

It used to call /tools/contract_draft, which guessed the type from keywords,
filled every draft with the same defaults (California law, a two-year term)
whatever the user asked for, and persisted the contract before anyone had
seen it — the one agent write that bypassed the approval card (release gate 4).

The tool name is kept so the chat's Doc artifact rendering keeps working.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

PREVIEW_HTML_CHARS = 15_000


class ContractCreateFromTemplateArgs(BaseModel):
    user_message: str = Field(
        ...,
        description=(
            "Free-text description of what to draft, with the type, the counterparty and any terms the user "
            "gave — e.g. 'mutual NDA for Apple, 2-year term, California governing law'."
        ),
    )
    contract_type: Optional[str] = Field(
        None, description="Contract type hint: NDA | MSA | SOW | VENDOR_AGREEMENT | LICENSE | EMPLOYMENT | DATA_PROCESSING.",
    )
    counterparty_name: Optional[str] = Field(None, description="The other party's company name.")
    title: Optional[str] = Field(None, description="Optional title for the new contract.")


def draft_proposal(result: Dict[str, Any], *, title: Optional[str], counterparty_name: Optional[str]) -> Dict[str, Any]:
    """The Apply card for a finished draft, or an error the model relays. PURE."""
    if result.get("error") or not result.get("usedTemplateId") or not result.get("html"):
        return {
            "error": "NO_TEMPLATE_MATCH" if not result.get("usedTemplateId") else "DRAFT_FAILED",
            "detail": result.get("error") or "No published template fits this request. Create one in Templates first.",
        }
    contract_type = result.get("contractType") or "contract"
    computed_title = (title or "").strip() or (
        f"{counterparty_name} — {contract_type}" if counterparty_name else f"Draft — {result.get('usedTemplateName')}"
    )
    missing = [str(m) for m in (result.get("missingFields") or result.get("unfilledVariables") or [])][:20]
    summary = f"Create draft “{computed_title}” from the {result.get('usedTemplateName')} template"
    if missing:
        summary += f" ({len(missing)} field{'s' if len(missing) != 1 else ''} still to fill)"
    return {
        "awaitingConfirmation": True,
        "args": {
            "templateId": result["usedTemplateId"],
            "variables": result.get("variableValues") or {},
            "title": computed_title,
            **({"counterpartyName": counterparty_name} if counterparty_name else {}),
        },
        "preview": {
            "summary": summary,
            "title": computed_title,
            "template": result.get("usedTemplateName"),
            "contractType": contract_type,
            "html": str(result.get("html") or "")[:PREVIEW_HTML_CHARS],
            "completeness": result.get("completenessScore"),
            "missingFields": missing,
            "reviewNotes": result.get("reviewNotes"),
        },
        "reversible": True,
    }


def build_contract_create_from_template(org_id: str, user_id: str | None = None) -> StructuredTool:
    async def _arun(
        user_message: str,
        contract_type: Optional[str] = None,
        counterparty_name: Optional[str] = None,
        title: Optional[str] = None,
    ) -> Dict[str, Any]:
        from ..agents.draft_agent import run_draft

        context = {k: v for k, v in {"contract_type": contract_type, "counterparty_name": counterparty_name}.items() if v}
        try:
            result = await run_draft(user_message, org_id, user_id or "system", context=context)
        except Exception as exc:
            log.warning("[contract_create_from_template] draft failed: %s", exc)
            return {"error": "DRAFT_FAILED", "detail": str(exc)[:300]}
        return draft_proposal(result, title=title, counterparty_name=counterparty_name)

    def _run(user_message: str, contract_type: Optional[str] = None,
             counterparty_name: Optional[str] = None, title: Optional[str] = None):
        import asyncio
        return asyncio.run(_arun(user_message, contract_type, counterparty_name, title))

    return StructuredTool.from_function(
        coroutine=_arun, func=_run,
        name="contract_create_from_template",
        description=(
            "Draft a new contract from the org's templates, filled from the user's request. Returns a draft for "
            "the user to review and create with Apply — nothing is created until they do. USE THIS when the user "
            "asks to draft, create or prepare a contract, NDA, MSA, SOW or order form. Promising a draft without "
            "calling this tool is a failure mode. Relay NO_TEMPLATE_MATCH honestly: the org has no template for "
            "that type yet."
        ),
        args_schema=ContractCreateFromTemplateArgs,
    )
