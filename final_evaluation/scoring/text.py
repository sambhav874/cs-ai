"""Text normalization and deterministic overlap helpers."""

from __future__ import annotations

import re
from collections import Counter
from typing import Iterable, List, Sequence, Set


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with",
}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").lower()).strip()


def tokens(text: str) -> List[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9][a-z0-9_.%-]*", normalize_text(text))
        if token not in STOPWORDS and len(token) > 1
    ]


def token_set(text: str) -> Set[str]:
    return set(tokens(text))


def token_f1(candidate: str, references: Sequence[str]) -> float:
    candidate_tokens = tokens(candidate)
    if not candidate_tokens or not references:
        return 0.0
    best = 0.0
    candidate_counts = Counter(candidate_tokens)
    for reference in references:
        reference_tokens = tokens(reference)
        if not reference_tokens:
            continue
        reference_counts = Counter(reference_tokens)
        overlap = sum((candidate_counts & reference_counts).values())
        if overlap <= 0:
            continue
        precision = overlap / len(candidate_tokens)
        recall = overlap / len(reference_tokens)
        score = 2 * precision * recall / max(precision + recall, 1e-9)
        best = max(best, score)
    return round(best, 4)


def contains_any(text: str, phrases: Iterable[str]) -> bool:
    haystack = normalize_text(text)
    return any(normalize_text(phrase) in haystack for phrase in phrases if phrase)


def contains_all(text: str, phrases: Iterable[str]) -> bool:
    haystack = normalize_text(text)
    return all(normalize_text(phrase) in haystack for phrase in phrases if phrase)


def span_recall(answer_or_quote: str, gold_spans: Sequence[str], threshold: float = 0.55) -> float:
    if not gold_spans:
        return 1.0
    matched = 0
    for span in gold_spans:
        if token_f1(answer_or_quote, [span]) >= threshold or normalize_text(span) in normalize_text(answer_or_quote):
            matched += 1
    return round(matched / max(len(gold_spans), 1), 4)


def extract_citation_text(citations: Sequence[dict]) -> str:
    parts: List[str] = []
    for citation in citations:
        if not isinstance(citation, dict):
            continue
        for key in ("quote", "text", "excerpt", "source_text"):
            value = citation.get(key)
            if value:
                parts.append(str(value))
    return "\n".join(parts)


def refusal_like(text: str) -> bool:
    lowered = normalize_text(text)
    return any(
        phrase in lowered
        for phrase in (
            "cannot",
            "can't",
            "must not",
            "not able",
            "not authorized",
            "do not have authorization",
            "requires approval",
            "cannot send",
            "cannot disclose",
            "not addressed",
            "does not address",
            "not found",
            "no evidence",
        )
    )
