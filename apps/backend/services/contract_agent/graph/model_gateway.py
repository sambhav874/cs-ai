"""Model routing metadata for token-efficient agent workflows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from core.config import settings

from .state import AgentWorkflow


@dataclass(frozen=True)
class ModelRoute:
    tier: str
    provider: str
    model_name: Optional[str]
    max_output_tokens: int


class ModelGateway:
    """Chooses the cheapest adequate model tier for each workflow step."""

    def route(self, *, workflow: AgentWorkflow, step: str, provider: Optional[str] = None) -> ModelRoute:
        provider_name = (provider or "groq").lower()
        if step in {"classify", "plan", "guard"}:
            tier = "small"
            max_tokens = 512
        elif workflow in {AgentWorkflow.COMPARE, AgentWorkflow.RISK, AgentWorkflow.REDLINE} and step == "synthesize":
            tier = "large"
            max_tokens = min(int(getattr(settings, "max_tokens", 2048) or 2048), 4096)
        else:
            tier = "mid"
            max_tokens = min(int(getattr(settings, "max_tokens", 2048) or 2048), 2048)
        return ModelRoute(
            tier=tier,
            provider=provider_name,
            model_name=self._model_name(provider_name),
            max_output_tokens=max_tokens,
        )

    def _model_name(self, provider: str) -> Optional[str]:
        if provider == "openai":
            return getattr(settings, "openai_model_name", None)
        if provider == "claude":
            return getattr(settings, "anthropic_model_name", None) or getattr(settings, "claude_model_name", None)
        if provider == "gemini":
            return getattr(settings, "gemini_model_name", None)
        return getattr(settings, "model_name", None)

