"""User preference memory (F-22's preferences half; corrections shipped separately
as the approval-gated `correct_fact` tool wired to `ProjectMemoryManager.supersede_fact`).

Practice area, jurisdiction, citation style, and verbosity are durable facts
about *how* a lawyer wants to work, not about any one contract — they belong
next to identity in the composed context, not behind a tool call the model has
to think to make. Scoped by (user_id, org_id): the same person can reasonably
want different defaults across two accounts (e.g. a solo practice vs. a firm
with a house citation style).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from .composer import MemoryBlock, _PRIORITY

_ALLOWED_FIELDS = ("practice_area", "jurisdiction", "citation_style", "verbosity")

_LABELS = {
    "practice_area": "Practice area",
    "jurisdiction": "Jurisdiction focus",
    "citation_style": "Citation style",
    "verbosity": "Answer verbosity",
}


def _sanitize(values: Dict[str, Any]) -> Dict[str, str]:
    clean: Dict[str, str] = {}
    for key in _ALLOWED_FIELDS:
        value = str(values.get(key) or "").strip()
        if value:
            clean[key] = value[:200]
    return clean


class UserPreferencesManager:
    """Reads and writes the per-(user, org) preference document."""

    def __init__(self, mongo_db):
        self.preferences = mongo_db["user_preferences"]

    def get(self, user_id: str, org_id: Optional[str] = None) -> Dict[str, str]:
        doc = self.preferences.find_one({"user_id": user_id, "org_id": org_id or None}) or {}
        return _sanitize(doc.get("values") or {})

    def save(self, user_id: str, org_id: Optional[str], values: Dict[str, Any]) -> Dict[str, str]:
        clean = _sanitize(values)
        self.preferences.update_one(
            {"user_id": user_id, "org_id": org_id or None},
            {"$set": {"values": clean, "updated_at": datetime.utcnow()}},
            upsert=True,
        )
        return clean


def preferences_block(values: Dict[str, str]) -> Optional[MemoryBlock]:
    """A short composer block, or None if nothing is set.

    Absence must mean absence — an empty block with a heading and no lines
    would read as "the user has no preferences" rather than "no one set any",
    so a caller with nothing to show should not add a block at all.
    """
    lines = [f"- {_LABELS[key]}: {value}" for key, value in values.items() if key in _LABELS]
    if not lines:
        return None
    return MemoryBlock(
        name="preferences",
        tier="semantic",
        heading="User preferences",
        body="\n".join(lines),
        priority=_PRIORITY["preferences"],
        provenance="account settings · set by the user",
    )
