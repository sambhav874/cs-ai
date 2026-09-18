"""Tests for user preference memory (Phase 2.5's preferences half, F-22).

No Mongo — UserPreferencesManager touches exactly one collection through
find_one/update_one, so a small fake stands in for it.
"""

from __future__ import annotations

from services.memory.composer import _PRIORITY
from services.memory.preferences import UserPreferencesManager, preferences_block


class FakeCollection:
    def __init__(self):
        self.docs = {}

    def find_one(self, query):
        return self.docs.get((query["user_id"], query["org_id"]))

    def update_one(self, query, update, upsert=False):
        key = (query["user_id"], query["org_id"])
        doc = self.docs.get(key, {"user_id": query["user_id"], "org_id": query["org_id"]})
        doc.update(update["$set"])
        self.docs[key] = doc


class FakeDB:
    def __init__(self):
        self.collection = FakeCollection()

    def __getitem__(self, name):
        assert name == "user_preferences"
        return self.collection


def test_get_returns_empty_for_a_user_with_no_saved_preferences():
    manager = UserPreferencesManager(FakeDB())
    assert manager.get("user-1", "org-1") == {}


def test_save_then_get_round_trips_allowed_fields():
    manager = UserPreferencesManager(FakeDB())
    manager.save(
        "user-1",
        "org-1",
        {"practice_area": "M&A", "jurisdiction": "Delaware", "citation_style": "bluebook"},
    )
    assert manager.get("user-1", "org-1") == {
        "practice_area": "M&A",
        "jurisdiction": "Delaware",
        "citation_style": "bluebook",
    }


def test_save_drops_unknown_fields_and_blank_values():
    manager = UserPreferencesManager(FakeDB())
    manager.save(
        "user-1",
        "org-1",
        {"practice_area": "  ", "jurisdiction": "NY", "not_a_real_field": "x"},
    )
    assert manager.get("user-1", "org-1") == {"jurisdiction": "NY"}


def test_preferences_are_isolated_per_org_for_the_same_user():
    manager = UserPreferencesManager(FakeDB())
    manager.save("user-1", "org-a", {"practice_area": "Litigation"})
    manager.save("user-1", "org-b", {"practice_area": "Corporate"})
    assert manager.get("user-1", "org-a")["practice_area"] == "Litigation"
    assert manager.get("user-1", "org-b")["practice_area"] == "Corporate"


def test_preferences_block_is_none_when_nothing_is_set():
    assert preferences_block({}) is None


def test_preferences_block_renders_only_known_fields_at_the_reserved_priority():
    block = preferences_block({"practice_area": "M&A", "bogus_field": "x"})
    assert block is not None
    assert block.priority == _PRIORITY["preferences"]
    assert block.tier == "semantic"
    assert "Practice area: M&A" in block.body
    assert "bogus_field" not in block.body
