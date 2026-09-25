"""Key-term analysis for a platform contract, and its hand-off to the API.

The lifecycle API asks for an analysis once it knows the contract's type
(POST /internal/contracts/{id}/analyse). The request is stored here, keyed by
the platform contract id, and a worker task runs it:

  • on the linked analysis copy's text (index.content) when that is ready —
    it has pages, so every record gets one;
  • on the platform's own plain text when the contract will never have an
    analysis copy (plain-text contracts, drafts never exported), or when the
    copy did not arrive or failed to index in time. The result is still
    verified against that text; it just has no page numbers.

The result goes to POST /api/internal/contracts/{id}/analysis/sync, which
writes key terms, summary, risk and clauses and marks the analysis done.
A newer request supersedes an older one (a user re-typing the contract): the
older task sees a different run id and stops.

The decisions (which text, how long to wait, what to send) are pure functions
here, tested without Celery, Mongo or a model.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

from services.key_terms import Invoke, NoProviderConfigured

logger = logging.getLogger(__name__)

SYNC_PATH_TEMPLATE = "/api/internal/contracts/{id}/analysis/sync"
REQUESTS_COLLECTION = "platform_analysis_requests"

# How long to wait for the analysis copy before using the platform's text.
LINK_WAIT = timedelta(minutes=5)       # copy not created yet
INDEX_WAIT = timedelta(minutes=25)     # copy created, still being parsed
POLL_SECONDS = 30
MAX_OUTPUT_TOKENS = 8192  # Groq's ceiling; the answers here are well under it

WAIT = "wait"
ANALYSIS_COPY = "analysis_copy"
PLATFORM_TEXT = "platform_text"


def new_request(
    platform_contract_id: str,
    *,
    org_id: str,
    version_id: str,
    plain_text: str,
    contract_type: Optional[str],
    custom_fields: List[Dict[str, Any]],
    expect_linked: bool,
    run_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    return {
        "_id": platform_contract_id,
        # The API names the run so it can tell a superseded result from the
        # current one; a caller that does not gets a fresh id.
        "run_id": run_id or uuid.uuid4().hex,
        "org_id": org_id,
        "version_id": version_id,
        "plain_text": plain_text or "",
        "contract_type": contract_type,
        "custom_fields": custom_fields,
        "expect_linked": expect_linked,
        "requested_at": now or datetime.utcnow(),
        "status": "queued",
    }


def choose_source(
    request: Dict[str, Any],
    linked: Optional[Dict[str, Any]],
    now: datetime,
) -> Tuple[str, str]:
    """(WAIT, "") or (source name, text). PURE.

    Waiting is bounded: a copy that never arrives, or never finishes indexing,
    must not leave the contract at "analysing" forever.
    """
    waited = now - request["requested_at"]
    plain = request.get("plain_text") or ""
    if linked is None:
        if request.get("expect_linked") and waited < LINK_WAIT:
            return WAIT, ""
        return PLATFORM_TEXT, plain
    index = linked.get("index") or {}
    content = index.get("content") or ""
    if index.get("status") == "success" and content.strip():
        return ANALYSIS_COPY, content
    if index.get("status") == "error" or linked.get("status") == "Index Error":
        return PLATFORM_TEXT, plain
    if waited < INDEX_WAIT:
        return WAIT, ""
    return PLATFORM_TEXT, plain


def build_payload(
    platform_contract_id: str,
    *,
    run_id: str,
    version_id: str,
    status: str,
    source: Optional[str] = None,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    usage: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """What the API's analysis sync takes. PURE.

    Only a successful run carries an analysis; an error or skip must never be
    read as "this contract has no terms" and clear what a previous run found.
    """
    analysis = None
    if status == "success" and result is not None:
        analysis = {k: v for k, v in result.items() if k != "errors"}
    return {
        "platformContractId": platform_contract_id,
        "versionId": version_id,
        "runId": run_id,
        "status": status,
        "source": source,
        "error": (error or "")[:500] or None,
        "warnings": [str(e)[:200] for e in (result or {}).get("errors", [])][:10],
        "analysis": analysis,
        "usage": usage or None,
    }


class UsageMeter:
    """Tokens and calls for one run, as the providers report them."""

    def __init__(self) -> None:
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        # Which model answered, so the API meters it under the right name
        # and keeps a BYOK org's spend off the platform cap.
        self.provider: Optional[str] = None
        self.model: Optional[str] = None
        self.byok = False

    def add(self, message: Any, prompt_chars: int) -> None:
        usage = getattr(message, "usage_metadata", None) or {}
        meta = (getattr(message, "response_metadata", None) or {}).get("token_usage") or {}
        self.calls += 1
        # A character estimate stands in only when the provider reports nothing.
        self.input_tokens += int(usage.get("input_tokens") or meta.get("prompt_tokens") or prompt_chars // 4)
        self.output_tokens += int(usage.get("output_tokens") or meta.get("completion_tokens") or 0)

    def snapshot(self) -> Dict[str, Any]:
        return {
            "calls": self.calls, "inputTokens": self.input_tokens, "outputTokens": self.output_tokens,
            "provider": self.provider, "model": self.model, "byok": self.byok,
        }


def model_invoke(meter: UsageMeter, *, platform_model: Any = None) -> Invoke:
    """The extraction's model call, on the org's Admin → AI choice.

    Resolved once for the run by the caller (under use_platform_org), so the
    org's model, key and cost cap apply to every call in it.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    from services.contract_agent.graph.model_factory import build_chat_model

    llm = build_chat_model(
        platform_model=platform_model,
        purpose="classify",
        temperature=0,
        max_tokens=MAX_OUTPUT_TOKENS,
        optional=True,
    )
    if llm is None:
        raise NoProviderConfigured("No model provider is configured.")
    if platform_model is not None:
        meter.provider = platform_model.provider
        meter.model = platform_model.model
        meter.byok = platform_model.source == "byok"
    else:
        meter.provider = getattr(llm, "_llm_type", None) or type(llm).__name__
        meter.model = getattr(llm, "model_name", None) or getattr(llm, "model", None)

    def invoke(system: str, user: str) -> str:
        message = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
        meter.add(message, len(system) + len(user))
        content = getattr(message, "content", "") or ""
        if isinstance(content, list):
            content = " ".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
        return str(content)

    return invoke


def push(
    payload: Dict[str, Any],
    *,
    post: Optional[Callable[..., Any]] = None,
    api_url: Optional[str] = None,
    secret: Optional[str] = None,
) -> Dict[str, Any]:
    from services.platform_obligations import push_to_platform

    return push_to_platform(
        payload,
        post=post, api_url=api_url, secret=secret,
        path=SYNC_PATH_TEMPLATE.format(id=payload["platformContractId"]),
    )
