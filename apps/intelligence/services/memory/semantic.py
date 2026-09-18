"""Embedding-ranked recall for agent memories, and the gate on writing them.

Two things were wrong with `agent_memories` (F-18, F-20).

Recall was not semantic. `_semantic_memories` loaded the twelve most recently
updated records and scored them by counting how many query tokens appeared
somewhere in the string. A paraphrase — "what do we owe them each month?" after
a turn about invoicing — shares no tokens and scored zero, so recall failed
silently and looked like an empty memory rather than a missed one.

Writing was not gated. `remember_turn` fired on *every* completed turn whose
question matched one of five hardcoded keyword buckets, and **overwrote** that
bucket. A contract's "payment_terms" memory was simply the most recent answer
that happened to mention an invoice: unreviewed, uncited, and presented to the
model as a "useful remembered topic".

Both are fixed here. Embeddings come from the same provider the rest of the
system uses, so there is one embedding-model choice in the codebase.

On not using a vector index: recall is scoped to one `(contract_id, user_id)`
pair, which is tens of records, not thousands. An exact cosine over stored
vectors is both simpler and *more* accurate than an approximate index, and it
avoids standing up a namespace whose lifecycle would then need its own
invalidation path. If a scope ever grows past `MAX_CANDIDATES` this should move
behind the real index rather than silently ranking a truncated candidate set —
which is why exceeding it is logged.
"""

from __future__ import annotations

import logging
import math
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)


# Records considered per scope before ranking. See the module docstring.
MAX_CANDIDATES = 200

# Recall drops to half weight at this age. Contract memory is not news — a term
# learned six months ago is usually still true — so this is deliberately long.
# It breaks ties toward recent knowledge without burying older knowledge.
RECENCY_HALF_LIFE_DAYS = 90.0

# The least a memory's age can cost it. Decay is meant to break ties between
# comparably relevant memories, not to outrank relevance: multiplying an
# unfloored 0.5^(age/half-life) against the score meant a two-quarter-old exact
# match lost to a barely-related answer from this morning. Contract knowledge
# does not expire on that schedule — a notice period learned in January is
# usually still the notice period. With the floor, age can move a memory down
# the ranking but cannot push a strong match below a weak one.
RECENCY_FLOOR = 0.5

# Below this a record is not related enough to spend context on. Cosine over
# normalized embeddings of short texts, so this is a "roughly on topic" line,
# not a "means the same thing" one.
MIN_RELEVANCE = 0.35


def _embeddings() -> Optional[Any]:
    try:
        from services.contract_agent.rag.vector_store import get_singleton_embeddings

        return get_singleton_embeddings()
    except Exception:
        logger.debug("No embeddings backend available for memory recall", exc_info=True)
        return None


def embed(text: str) -> Optional[List[float]]:
    """Embed one string, or None if no backend is configured.

    None is a supported outcome, not an error: local dev without an embeddings
    key still needs working chat, and callers fall back to lexical ranking.
    """
    text = (text or "").strip()
    if not text:
        return None
    backend = _embeddings()
    if backend is None:
        return None
    try:
        return [float(value) for value in backend.embed_query(text)]
    except Exception:
        logger.warning("Memory embedding failed", exc_info=True)
        return None


def cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def recency_weight(
    updated_at: Any,
    *,
    now: Optional[datetime] = None,
    half_life_days: float = RECENCY_HALF_LIFE_DAYS,
) -> float:
    """Exponential decay in [0, 1]. Unknown timestamps do not get penalised.

    A record with no `updated_at` is far more likely to predate the field than
    to be ancient, and scoring it as maximally stale would hide exactly the
    migrated records that most need review rather than deletion.
    """
    if not isinstance(updated_at, datetime) or half_life_days <= 0:
        return 1.0
    reference = now or datetime.utcnow()
    age_days = max(0.0, (reference - updated_at).total_seconds() / 86400.0)
    return 0.5 ** (age_days / half_life_days)


def _lexical_score(question: str, record: Dict[str, Any]) -> float:
    """The old behaviour, kept only as the no-embeddings fallback.

    Normalised by query length so it is comparable to a cosine, rather than
    being a raw count that always loses or always wins against one.
    """
    terms = {token.lower() for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{3,}", question or "")}
    if not terms:
        return 0.0
    haystack = f"{record.get('memory_key', '')} {record.get('content', '')}".lower()
    return sum(1 for term in terms if term in haystack) / len(terms)


def rank(
    question: str,
    records: Sequence[Dict[str, Any]],
    *,
    limit: int = 3,
    now: Optional[datetime] = None,
    min_relevance: float = MIN_RELEVANCE,
    query_vector: Optional[Sequence[float]] = None,
) -> List[Dict[str, Any]]:
    """Rank memories by relevance × recency.

    Records that were stored before embeddings existed, or while the backend
    was unavailable, carry no vector. They fall back to the lexical score
    rather than being dropped — they are still the user's memory, and 2.6's
    decay is what should retire them, not an implementation detail of how they
    happened to be written.
    """
    if not records:
        return []
    if len(records) > MAX_CANDIDATES:
        logger.info(
            "Memory scope exceeded %s candidates; ranking a truncated set", MAX_CANDIDATES
        )
        records = list(records)[:MAX_CANDIDATES]

    vector = list(query_vector) if query_vector is not None else embed(question)

    scored: List[tuple] = []
    for record in records:
        stored = record.get("embedding")
        if vector and stored:
            relevance = cosine(vector, stored)
        else:
            relevance = _lexical_score(question, record)
        if relevance < min_relevance:
            continue
        decay = recency_weight(record.get("updated_at"), now=now)
        weight = RECENCY_FLOOR + (1.0 - RECENCY_FLOOR) * decay
        scored.append((relevance * weight, record))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [record for _, record in scored[:limit]]


def is_durable_answer(
    *,
    citation_count: int,
    confidence: Any,
    answer: str,
    explicit_request: bool = False,
) -> bool:
    """The write gate.

    An answer earns a durable memory only when the user asked for it, or when
    it was backed by validated citations at high confidence. Everything else is
    a conversation turn — already recorded as one, already summarised, and
    already recallable within the session.

    This is the whole of F-20's fix: the old rule was "the question mentioned
    one of five keywords", which is not evidence of anything being worth
    keeping.
    """
    if explicit_request:
        return True
    if citation_count <= 0:
        return False
    if not (answer or "").strip():
        return False
    return str(confidence or "").strip().lower() in {"high", "medium"}
