"""Citation and structured-answer normalization for contract-agent responses."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from utils.text_cleanup import clean_text_encoding

from .schemas import ExtractedAnswer, Reference, TextSegment


def fallback_extracted_answer(question: str, reason: str = "Information not found in the current context.") -> ExtractedAnswer:
    return ExtractedAnswer(
        question=question,
        value="The provided contract context does not explicitly address this specific inquiry.",
        reference=Reference(segment_ids=[], justification=reason, confidence="low"),
        confidence="low",
    )


def normalize_model_answers(
    *,
    questions: List[str],
    model_items: Iterable[Dict[str, Any]],
    segment_map: Dict[str, TextSegment],
) -> Tuple[Dict[str, ExtractedAnswer], List[str]]:
    lookup = {}
    for item in model_items or []:
        if isinstance(item, dict) and item.get("question"):
            lookup[_norm(str(item["question"]))] = item

    answers: Dict[str, ExtractedAnswer] = {}
    missing: List[str] = []
    for question in questions:
        item = _find_answer(question, lookup)
        if not item:
            missing.append(question)
            continue
        value = clean_text_encoding(str(item.get("value") or "")).strip()
        segment_ids = item.get("segment_ids") or []
        if not isinstance(segment_ids, list):
            segment_ids = []
        valid_segment_ids = [segment_id for segment_id in segment_ids if isinstance(segment_id, str) and segment_id in segment_map]
        confidence = str(item.get("confidence") or "low").lower()
        if confidence not in {"high", "medium", "low"}:
            confidence = "low"
        answers[question] = ExtractedAnswer(
            question=question,
            value=value,
            reference=Reference(
                segment_ids=valid_segment_ids,
                justification=clean_text_encoding(str(item.get("justification") or "No justification provided.")),
                confidence=confidence,
            ),
            confidence=confidence,
        )
    return answers, missing


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", clean_text_encoding(value or "").lower()).strip()


def _find_answer(question: str, lookup: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    normalized = _norm(question)
    if normalized in lookup:
        return lookup[normalized]
    for candidate_question, item in lookup.items():
        if _answers_match(normalized, candidate_question):
            return item
    return None


def _answers_match(asked: str, answered: str) -> bool:
    if asked == answered or asked in answered or answered in asked:
        return True
    asked_words = set(asked.split())
    answered_words = set(answered.split())
    if not asked_words or not answered_words:
        return False
    denominator = min(len(asked_words), len(answered_words))
    return len(asked_words & answered_words) / denominator >= 0.75
