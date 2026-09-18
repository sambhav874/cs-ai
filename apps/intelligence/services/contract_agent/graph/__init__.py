"""Deep workflow agent package for ContractSense.

The modules in this package keep orchestration concerns separate from the
legacy RAG facade so contract chat, global chat, approvals, and tabular review
workflows can share the same typed state and policy gates.
"""

from .runner import DeepContractAgentRunner
from .state import (
    AgentContext,
    AgentResponse,
    AgentRunState,
    AgentStatus,
    AgentSurface,
    AgentWorkflow,
    ApprovalDecision,
    ApprovalRequest,
    TabularReviewProposal,
)

__all__ = [
    "AgentContext",
    "AgentResponse",
    "AgentRunState",
    "AgentStatus",
    "AgentSurface",
    "AgentWorkflow",
    "ApprovalDecision",
    "ApprovalRequest",
    "DeepContractAgentRunner",
    "TabularReviewProposal",
]
