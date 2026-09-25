"""Multi-part questions: split them, and make sure every part is answered.

The NHS evaluation asked one question with five parts and got an answer to
two of them, with nothing to say the other three had been skipped. A reader
cannot tell "the contract is silent on this" from "the agent never looked".

This module does two deterministic things around the model:

  • `split_parts` finds the parts a question enumerates — numbered or
    lettered items, bullet lines, or several separate questions — so the
    agent is told, before it starts, exactly what it has to answer;
  • `missing_parts` checks the answer against them, so the runtime can ask
    once for what was skipped and, failing that, say plainly which parts
    were not found rather than end on a partial answer.

No model call: a plan the code can see is a plan the code can enforce.
"""
from __future__ import annotations

import re
from typing import List, Sequence

MAX_PARTS = 8
MIN_PART_CHARS = 8
# Share of a part's significant words the answer must use, when the answer
# does not label the part by its number.
ANSWERED_OVERLAP = 0.5

_ENUMERATED = re.compile(
    r"(?:^|\n|\s)(?:\(?([0-9]{1,2}|[a-hA-H]|i{1,3}|iv|v|vi{0,3})[.)]|[-*•])\s+(?=\S)",
)
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "what", "which", "who",
    "how", "does", "do", "did", "this", "that", "these", "those", "under", "with", "by", "from", "be",
    "it", "its", "as", "at", "any", "there", "our", "we", "they", "their", "contract", "agreement",
}


def _words(text: str) -> List[str]:
    return [w for w in re.findall(r"[a-z0-9][a-z0-9'%£$.-]*", (text or "").lower()) if w not in _STOP and len(w) > 2]


def split_parts(question: str) -> List[str]:
    """The parts a question asks for, in order; [] when it is one question."""
    text = (question or "").strip()
    if not text:
        return []

    # 1. Enumerated items: "1) ... 2) ...", "(a) ... (b) ...", bullet lines.
    marks = list(_ENUMERATED.finditer(text))
    if len(marks) >= 2:
        parts = []
        for i, mark in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            part = text[mark.end():end].strip(" \n;,")
            if len(part) >= MIN_PART_CHARS:
                parts.append(re.sub(r"\s+", " ", part))
        if len(parts) >= 2:
            return parts[:MAX_PARTS]

    # 2. Several questions: more than one question mark.
    questions = [q.strip() for q in re.findall(r"[^?]+\?", text)]
    questions = [re.sub(r"^(?:and|also|then)\s+", "", re.sub(r"\s+", " ", q), flags=re.I) for q in questions]
    questions = [q for q in questions if len(q) >= MIN_PART_CHARS]
    if len(questions) >= 2:
        return questions[:MAX_PARTS]
    return []


def plan_block(parts: Sequence[str]) -> str:
    """The instruction the agent gets for a multi-part question."""
    lines = "\n".join(f"  {i}. {p}" for i, p in enumerate(parts, 1))
    return (
        f"This question has {len(parts)} parts. Answer every one, in order, each under its number "
        f"(\"**1.**\", \"**2.**\" ...). Search for each part separately rather than relying on one search. "
        f"If the documents do not address a part, say so under its number — \"Not found in the documents "
        f"searched\" — rather than leaving it out.\n{lines}"
    )


def _labelled(answer: str, number: int) -> bool:
    return bool(re.search(
        rf"(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?\s*(?:part\s*)?\(?{number}[.):]", answer, flags=re.IGNORECASE,
    ))


def missing_parts(parts: Sequence[str], answer: str) -> List[int]:
    """1-based numbers of the parts the answer does not address."""
    missing = []
    answer_words = set(_words(answer))
    for number, part in enumerate(parts, 1):
        if _labelled(answer, number):
            continue
        words = set(_words(part))
        if words and len(words & answer_words) / len(words) >= ANSWERED_OVERLAP:
            continue
        missing.append(number)
    return missing


def follow_up(parts: Sequence[str], missing: Sequence[int], *, next_ref: int = 1) -> str:
    listed = "\n".join(f"  {n}. {parts[n - 1]}" for n in missing)
    return (
        "Your answer did not address these parts of the question:\n" + listed +
        "\nAnswer each of them now, under its number, searching the documents for each. If the documents do "
        "not address one, write \"Not found in the documents searched\" under its number. Do not repeat the "
        f"parts you already answered. Number any new citations from [{next_ref}]."
    )


def not_found_note(parts: Sequence[str], missing: Sequence[int]) -> str:
    """What the answer ends with when parts are still unanswered."""
    return "\n\n" + "\n".join(
        f"**{n}.** {parts[n - 1]} — Not found in the documents searched." for n in missing
    )
