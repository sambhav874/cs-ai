"""draftLegal's agent service, served by the intelligence tier under /agents.

TODO(licence): this package is draftLegal code (AGPL-3.0, see LICENSE and
NOTICE beside this file). It moved here from apps/agents with `git mv`, so
`git log --follow` still shows where each line came from.

TODO(merge): the routes below are draftLegal's original HTTP contract, kept
so the lifecycle API's callers did not have to change in the same commit.
Each one that ContractSense's pipeline already covers (extraction,
obligations, Q&A with citations) is being pointed at that pipeline; when the
last caller has moved, the duplicate route goes. /extract_obligations has
gone: obligations come from ContractSense's extraction and reach the API
through /api/internal/obligations/sync.

Every route requires the shared INTERNAL_SERVICE_SECRET, exactly as the old
service's middleware did, and fails closed when it is not configured.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from api.routes.internal import require_internal_secret

from agents_service import tracing
from agents_service.routes import (
    agent,
    approval,
    assist,
    chat,
    classify,
    compliance,
    detect_binder,
    draft,
    extract,
    intake,
    playbook_review,
    redline,
    renewals,
    review,
)

# Same mount order and prefixes as apps/agents/main.py had, so every path the
# API calls is unchanged apart from the /agents prefix.
agents_router = APIRouter(prefix="/agents", dependencies=[Depends(require_internal_secret)])
agents_router.include_router(chat.router, prefix="/agent")
for module in (review, agent, detect_binder, classify, intake, draft, assist, extract,
               redline, playbook_review, approval, renewals, compliance):
    agents_router.include_router(module.router)

# Health sits outside the secret, as it did before: probes carry no secret.
agents_health_router = APIRouter(prefix="/agents")


@agents_health_router.get("/health")
async def health():
    # A tier-2 eval needs the service REPLAYING; "is it up" cannot tell a
    # replayed run from one silently hitting a live model.
    from agents_service.replay import mode as _replay_mode
    return {"status": "ok", "replayMode": _replay_mode()}


def flush_tracing() -> None:
    """Flush buffered Langfuse traces on shutdown. No-op when tracing is off."""
    tracing.flush()
