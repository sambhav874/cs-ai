"""Quotes a draftLegal agent returns, checked against the text it was given.

Compliance findings, playbook-judge evidence and redline `before` text are
all presented as the contract's own words. A model can paraphrase or invent
them, and until now nothing checked. These helpers hold them to the same rule
as ContractSense's extraction (services/quote_locator.py): a quote is kept
only if it is in the text, and is replaced by the text's own wording;
otherwise it is removed and the record says so.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from services.quote_locator import SourceText


def verified_quote(quote: Any, source: SourceText) -> Optional[str]:
    """The source's own words for `quote`, or None if it is not there."""
    if not isinstance(quote, str) or not quote.strip():
        return None
    span = source.locate(quote)
    return source.display(span) if span is not None else None


def verify_field(record: Dict[str, Any], key: str, source: SourceText, *, flag: str = "quoteVerified") -> bool:
    """Check record[key] in place: replaced with the source text when found,
    set to None when not. Sets record[flag]; returns whether it verified.
    A record with no quote to check is left as it is, flagged False."""
    quote = record.get(key)
    if quote in (None, ""):
        record[flag] = False
        return False
    found = verified_quote(quote, source)
    record[key] = found
    record[flag] = found is not None
    return found is not None


def verified_changes(changes: Any, original: str) -> list:
    """A redline's change list, keeping only changes whose `before` is really
    in the original clause, in the clause's own words.

    `before` is what a reviewer is told will be replaced, and what the Word
    export marks as deleted; a paraphrased `before` shows a deletion of text
    the contract never contained. Changes that fail are dropped — the variant's
    proposedText is unaffected, only its explanation of itself is corrected.
    """
    source = SourceText(original or "")
    out = []
    for change in changes if isinstance(changes, list) else []:
        if not isinstance(change, dict):
            continue
        before = verified_quote(change.get("before"), source)
        if before is None:
            continue
        out.append({**change, "before": before})
    return out
