"""draftLegal's agent service, served by the intelligence tier under /agents.

TODO(licence): this package is draftLegal code (AGPL-3.0, see LICENSE and
NOTICE beside this file). It moved here from apps/agents with `git mv`, so
`git log --follow` still shows where each line came from.

The routes below keep draftLegal's original HTTP contract, so the lifecycle
API's callers did not change. The ones ContractSense's pipeline duplicated are
gone (agent merge P1-P2): /review (key terms: services/key_terms.py, synced
through /api/internal/contracts/{id}/analysis/sync), /extract_obligations
(obligations: /api/internal/obligations/sync), /agent/ask and
/agent/portfolio-query (the assistant's search_evidence and contract_filter).
/agent/chat runs on ContractSense's runtime (services/assistant). What remains
are draftLegal capabilities with no ContractSense counterpart: binder
detection, classification, intake, drafting, editor assist, structure
extraction, redlines, playbook review, approval summaries, renewal advice and
compliance checks.

Every route requires the shared INTERNAL_SERVICE_SECRET, exactly as the old
service's middleware did, and fails closed when it is not configured.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from api.routes.internal import require_internal_secret

from agents_service import tracing
from agents_service.routes import (
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
)

# Same mount order and prefixes as apps/agents/main.py had, so every path the
# API calls is unchanged apart from the /agents prefix.
agents_router = APIRouter(prefix="/agents", dependencies=[Depends(require_internal_secret)])
agents_router.include_router(chat.router, prefix="/agent")
for module in (detect_binder, classify, intake, draft, assist, extract,
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
