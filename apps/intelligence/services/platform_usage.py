"""Report this tier's model spend to the platform's usage metering.

The platform's Admin → AI Usage and daily cost cap only saw what passed
through the lifecycle API. Obligation extraction — the biggest spender, 413K
output tokens on the NHS contract — ran here and was metered nowhere the
admin could see. After a run on a linked contract, its token counts go to
POST /api/internal/usage, which attributes them to the contract's org.
(Key-term analysis and chat report through their own sync and stream.)
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

USAGE_PATH = "/api/internal/usage"


def usage_payload(platform_contract_id: str, tool_name: str, result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The report for one run, or None if it made no model calls. PURE."""
    calls = int(result.get("llm_calls") or 0)
    if calls <= 0:
        return None
    return {
        "platformContractId": platform_contract_id,
        "toolName": tool_name,
        "provider": str(result.get("llm_provider") or "unknown")[:60],
        "model": str(result.get("llm_model") or "unknown")[:120],
        "byok": bool(result.get("llm_byok")),
        "calls": calls,
        "inputTokens": int(result.get("llm_input_tokens") or 0),
        "outputTokens": int(result.get("llm_output_tokens") or 0),
    }


def report_usage(payload: Optional[Dict[str, Any]], *, post: Optional[Callable[..., Any]] = None) -> Dict[str, Any]:
    if payload is None:
        return {"status": "nothing_to_report"}
    from services.platform_obligations import push_to_platform

    return push_to_platform(payload, post=post, path=USAGE_PATH)
