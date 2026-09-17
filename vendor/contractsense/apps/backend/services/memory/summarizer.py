"""Rolling session summarization.

The previous implementation was not summarization. It bullet-listed the last
twelve older messages, truncated each to 220 characters, and **appended** the
result to the summary it already had — then capped the whole thing at 3500
characters from the front. So the summary grew monotonically until it started
eating its own beginning, which is precisely the part only it remembered. A
long session ended up with a verbose transcript of the middle and no trace of
what the conversation had been about (F-19).

This module folds instead of appending: the prior summary and the newly-aged
messages go in, one bounded summary comes out. Length stays flat, and the
oldest content survives as long as it stays relevant, because it is carried
forward by every fold rather than sitting at the front of a buffer waiting to
be cut.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)


# The fold's output budget. Roughly 300 tokens — enough for the durable shape
# of a conversation, small enough that the composer can afford it every turn.
SUMMARY_BUDGET_CHARS = 1200

# How much of each aged message the model is shown. Higher than the old 220
# because the fold reads them once and then they are gone; anything cut here is
# cut permanently.
MESSAGE_EXCERPT_CHARS = 600


_PROMPT = """You maintain the running summary of a conversation between a lawyer and a contract-analysis assistant.

You are given the existing summary and the messages that have just aged out of the visible window. Fold them into ONE new summary that replaces the existing one.

Rules:
- The existing summary is the ONLY record of everything earlier in this conversation. Carry its durable content forward. Losing it loses it permanently.
- Keep: what the user is trying to establish, decisions and conclusions reached, specific contract terms discussed (parties, dates, amounts, notice periods, obligations), corrections the user made, and anything still open.
- Drop: pleasantries, restatements, the assistant's hedging, and anything superseded by a later turn.
- Prefer specifics over description. "Notice period is 60 days, disputed by the user, who believes it is 30" beats "discussed notice periods".
- Never invent. If the existing summary and the new messages disagree, keep both and say which is later.
- Write plain prose or short bullets. No preamble, no heading, no meta-commentary about summarizing.
- Stay under {budget} characters.

EXISTING SUMMARY:
{prior}

NEWLY AGED MESSAGES:
{messages}

NEW SUMMARY:"""


def _clean(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def render_messages(messages: Sequence[Dict[str, Any]]) -> str:
    return "\n".join(
        f"{'User' if message.get('role') == 'user' else 'Assistant'}: "
        f"{_clean(message.get('content'), MESSAGE_EXCERPT_CHARS)}"
        for message in messages
        if str(message.get("content") or "").strip()
    )


def _trim_to_budget(text: str, budget: int) -> str:
    """Cut to the last complete sentence or bullet inside the budget.

    Cutting mid-sentence would leave the next fold reading a fragment as
    though it were a fact, and the fragment is what gets carried forward.
    """
    text = text.strip()
    if len(text) <= budget:
        return text
    window = text[:budget]
    for boundary in ("\n- ", "\n", ". "):
        cut = window.rfind(boundary)
        if cut > budget // 2:
            return window[: cut + (1 if boundary == ". " else 0)].strip()
    return window.strip()


def extractive_summary(
    prior_summary: str,
    messages: Sequence[Dict[str, Any]],
    *,
    budget: int = SUMMARY_BUDGET_CHARS,
) -> str:
    """The no-model fallback.

    Deliberately not the old append-and-truncate. The prior summary is kept
    whole and the new material is what gets squeezed, because the prior summary
    already represents many more turns per character than any single message
    does. A failing provider degrades the newest detail, never the history.
    """
    prior = _clean(prior_summary, budget)
    user_turns = [
        f"- User asked: {_clean(message.get('content'), 200)}"
        for message in messages
        if message.get("role") == "user" and str(message.get("content") or "").strip()
    ]
    if not user_turns:
        return prior
    room = max(0, budget - len(prior) - 2)
    if room < 40:
        return prior
    added = _trim_to_budget("\n".join(user_turns), room)
    return (f"{prior}\n{added}" if prior else added).strip()


def summarize_session(
    prior_summary: str,
    messages: Sequence[Dict[str, Any]],
    *,
    model: Optional[Any] = None,
    provider: Optional[str] = None,
    budget: int = SUMMARY_BUDGET_CHARS,
) -> str:
    """Fold `prior_summary` and `messages` into one replacement summary.

    `model` is injectable so this is testable without a provider, and so the
    caller can reuse a model it already built. Any failure falls back to
    `extractive_summary` rather than raising: a summary is an enhancement to a
    chat turn, and losing the turn to save the summary is the wrong trade.
    """
    rendered = render_messages(messages)
    if not rendered.strip():
        return _trim_to_budget(_clean(prior_summary, budget * 2), budget)

    chat_model = model
    if chat_model is None:
        try:
            from services.contract_agent.graph.model_factory import build_chat_model

            chat_model = build_chat_model(
                provider=provider,
                purpose="chat",
                temperature=0.0,
                task_type="summarization",
                optional=True,
            )
        except Exception:
            logger.debug("Session summarizer could not build a model", exc_info=True)
            chat_model = None

    if chat_model is None:
        return extractive_summary(prior_summary, messages, budget=budget)

    prompt = _PROMPT.format(
        budget=budget,
        prior=_clean(prior_summary, budget * 2) or "(none — this is the first fold)",
        messages=rendered,
    )
    try:
        from langchain_core.messages import HumanMessage

        result = chat_model.invoke([HumanMessage(content=prompt)])
        text = getattr(result, "content", result)
        if isinstance(text, list):
            text = " ".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in text
            )
        text = str(text or "").strip()
    except Exception:
        logger.warning("Session summarization failed; falling back to extractive", exc_info=True)
        return extractive_summary(prior_summary, messages, budget=budget)

    if not text:
        return extractive_summary(prior_summary, messages, budget=budget)
    return _trim_to_budget(text, budget)


def summarize_run_outcome(
    *,
    question: str,
    tools_called: Sequence[str],
    citation_count: int,
    confidence: Any = None,
    unsupported: bool = False,
    correction: str = "",
) -> str:
    """One line describing how a completed run went.

    Episodic memory of the agent's own work, not of the conversation. It makes
    "what have we already checked on this contract?" answerable without
    re-reading every answer, and it is the substrate the trajectory miner (2.4)
    reads — which is why the tool sequence is recorded in order rather than as
    a set.
    """
    parts: List[str] = [f"Asked: {_clean(question, 160)}"]
    if tools_called:
        parts.append("via " + " → ".join(tools_called))
    else:
        parts.append("answered without tools")
    if unsupported:
        parts.append("no supporting evidence found")
    elif citation_count:
        parts.append(f"{citation_count} cited")
    else:
        parts.append("uncited")
    if confidence:
        parts.append(f"confidence {confidence}")
    if correction:
        parts.append(f"user corrected: {_clean(correction, 160)}")
    return " · ".join(parts)
