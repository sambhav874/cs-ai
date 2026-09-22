"""comment_add — write tool (plan-then-execute).

Does NOT call the backend. Returns an awaiting-confirmation payload the
orchestrator surfaces as a `tool_call_awaiting_confirmation` event; the
web client renders an ActionPreview card and, on Apply, POSTs
/agent/threads/:id/actions/apply which dispatches to
/api/internal/ai/tools/comment_add with orgId/authorId enforced from
the JWT. Arg keys here must match that endpoint's schema.
"""
from __future__ import annotations

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


class CommentAddArgs(BaseModel):
    contract_id: str = Field(..., description="Contract CUID to comment on.")
    body:        str = Field(..., min_length=1, max_length=5000, description="Comment body (plain text).")
    clause_ref:  str | None = Field(None, max_length=120, description="Optional clause/section anchor like '9.2' or 'Limitation of Liability'.")


def build_comment_add(_org_id: str, _user_id: str | None = None) -> StructuredTool:
    async def _arun(contract_id: str, body: str, clause_ref: str | None = None) -> dict:
        # Endpoint-shaped args — the apply RPC injects orgId + authorId.
        args: dict = {"contractId": contract_id, "body": body}
        if clause_ref:
            args["clauseRef"] = clause_ref
        excerpt = body if len(body) <= 80 else body[:77] + "…"
        where = f" anchored to §{clause_ref}" if clause_ref else ""
        return {
            "awaitingConfirmation": True,
            "args": args,
            "preview": {
                "summary": f'Add a comment{where}: "{excerpt}"',
                "contractId": contract_id,
            },
            "reversible": True,
        }

    def _run(contract_id: str, body: str, clause_ref: str | None = None) -> dict:
        import asyncio
        return asyncio.run(_arun(contract_id, body, clause_ref))

    return StructuredTool.from_function(
        coroutine=_arun,
        func=_run,
        name="comment_add",
        description=(
            "Propose adding a comment to a contract (optionally anchored to "
            "a clause/section). The user confirms via an Apply card before "
            "anything is written. Use when asked to 'leave a note', 'flag "
            "this clause', or 'comment on the contract'."
        ),
        args_schema=CommentAddArgs,
    )
