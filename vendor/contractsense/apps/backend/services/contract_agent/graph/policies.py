"""Retired policy planner compatibility module.

ContractSense now uses the LangGraph ReAct runtime for model-selected actions.
This module intentionally does not classify intent, select tools, or generate
answers. Backend safety boundaries live in middleware and tool schemas instead.
"""

from __future__ import annotations

from typing import Any


class AgentPolicyEngine:
    """Compatibility shim for older imports.

    Any call into this class means a caller is trying to use the retired
    planner instead of the model-led LangGraph ReAct runner.
    """

    def __getattr__(self, name: str) -> Any:
        raise RuntimeError(
            f"AgentPolicyEngine.{name} is retired. Use DeepContractAgentRunner's "
            "LangGraph ReAct runtime instead."
        )
