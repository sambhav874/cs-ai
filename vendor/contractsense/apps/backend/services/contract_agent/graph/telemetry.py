"""Token, cost, and trace helpers for graph runs."""

from __future__ import annotations

from typing import Optional

from .state import CostEstimate, TokenUsage


MODEL_TIER_COST_PER_1K = {
    "small": 0.0002,
    "mid": 0.0010,
    "large": 0.0060,
}


def estimate_tokens(text: str) -> int:
    """Cheap token estimate for budgeting and proposal previews."""
    return max(1, len(text or "") // 4)


def estimate_usage(*parts: str, output_tokens: int = 220) -> TokenUsage:
    input_tokens = sum(estimate_tokens(part) for part in parts if part)
    total = input_tokens + max(0, output_tokens)
    return TokenUsage(input_tokens=input_tokens, output_tokens=max(0, output_tokens), total_tokens=total)


def estimate_cost(usage: TokenUsage, *, model_tier: str, model_name: Optional[str] = None) -> CostEstimate:
    rate = MODEL_TIER_COST_PER_1K.get(model_tier, MODEL_TIER_COST_PER_1K["mid"])
    return CostEstimate(model_tier=model_tier, model_name=model_name, cost_usd=round((usage.total_tokens / 1000) * rate, 6))
