"""Compatibility helpers for the retired classic ReAct executor."""

from __future__ import annotations

from typing import Any, Dict


class ApprovalRequiredError(Exception):
    """Raised by approval-gated tools to pause the LangGraph ReAct run."""

    def __init__(self, payload: Dict[str, Any]):
        self.payload = payload
        super().__init__(str(payload.get("message") or "Approval required."))


def build_agent_executor(*_args: Any, **_kwargs: Any) -> Any:
    raise RuntimeError(
        "The classic text ReAct path is retired. "
        "Use DeepContractAgentRunner, which wraps the unified ContractReActRuntime loop."
    )
