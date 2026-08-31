"""Facts emitted automatically at ingestion must be idempotent and must not
accumulate one live fact per revision.

Both properties matter because the memory composer sends the live fact set to
the agent under a fixed character budget: every redundant fact costs context
that a real one would otherwise have used.
"""

from datetime import datetime, timezone

from services.project_memory import ProjectMemoryManager


class FakeResult:
    def __init__(self, n):
        self.modified_count = n
        self.matched_count = n


def _matches(doc, query):
    for key, expected in query.items():
        actual = doc.get(key)
        if isinstance(expected, dict):
            if "$ne" in expected and actual == expected["$ne"]:
                return False
        elif actual != expected:
            return False
    return True


class FakeCollection:
    """Enough of pymongo for the fact paths under test."""

    def __init__(self):
        self.docs = []

    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return FakeResult(1)

    def find_one(self, query, projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return dict(doc)
        return None

    def update_one(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update["$set"])
                return FakeResult(1)
        return FakeResult(0)

    def update_many(self, query, update):
        n = 0
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update["$set"])
                n += 1
        return FakeResult(n)

    def find(self, query, projection=None):
        return FakeCursor([dict(d) for d in self.docs if _matches(d, query)])


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction):
        self.docs.sort(key=lambda d: d.get(key) or datetime.min, reverse=direction < 0)
        return self

    def __iter__(self):
        return iter(self.docs)


def _manager():
    manager = ProjectMemoryManager.__new__(ProjectMemoryManager)
    manager.facts = FakeCollection()
    manager.events = FakeCollection()
    manager.agent_memories = FakeCollection()
    return manager


def _record(manager, text, *, contract, signature, project="p1"):
    return manager.remember_fact(
        project_id=project,
        text=text,
        sources=[{"contract_id": contract, "quote": text}],
        origin="contract",
        dedup_key=f"schedule:{signature}:{contract}",
        supersedes_scope=f"schedule:{signature}",
    )


def test_reingesting_the_same_document_does_not_duplicate_the_fact():
    manager = _manager()
    first = _record(manager, "RAMP rose 3%.", contract="c1", signature="sig-a")
    second = _record(manager, "RAMP rose 3%.", contract="c1", signature="sig-a")

    assert first["fact_id"] == second["fact_id"]
    assert len(manager.facts.docs) == 1
    assert len(manager.list_facts("p1")) == 1


def test_reingestion_does_not_bump_the_sort_key_used_for_truncation():
    manager = _manager()
    _record(manager, "RAMP rose 3%.", contract="c1", signature="sig-a")
    learned_at = manager.facts.docs[0]["learned_at"]
    _record(manager, "RAMP rose 3% (reworded).", contract="c1", signature="sig-a")

    assert manager.facts.docs[0]["learned_at"] == learned_at
    assert manager.facts.docs[0]["text"] == "RAMP rose 3% (reworded)."


def test_a_new_revision_supersedes_the_previous_one_for_the_same_schedule():
    manager = _manager()
    _record(manager, "RAMP rose 3% in 2023.", contract="c1", signature="sig-a")
    newest = _record(manager, "RAMP rose 3% in 2024.", contract="c2", signature="sig-a")

    live = manager.list_facts("p1")
    assert [f["fact_id"] for f in live] == [newest["fact_id"]]
    # The earlier revision is retained, not deleted — the trail stays readable.
    assert len(manager.list_facts("p1", include_superseded=True)) == 2


def test_different_schedules_do_not_supersede_each_other():
    manager = _manager()
    _record(manager, "RAMP rose 3%.", contract="c1", signature="sig-a")
    _record(manager, "PASSENGER rose 3%.", contract="c1", signature="sig-b")

    assert len(manager.list_facts("p1")) == 2


def test_reingesting_an_older_document_does_not_walk_the_schedule_backwards():
    manager = _manager()
    _record(manager, "RAMP rose 3% in 2023.", contract="c1", signature="sig-a")
    newest = _record(manager, "RAMP rose 3% in 2024.", contract="c2", signature="sig-a")
    # c1 is reprocessed after c2 has already superseded its fact.
    _record(manager, "RAMP rose 3% in 2023.", contract="c1", signature="sig-a")

    live = manager.list_facts("p1")
    assert [f["fact_id"] for f in live] == [newest["fact_id"]]
    assert len(manager.facts.docs) == 2


def test_facts_are_listed_newest_first():
    manager = _manager()
    manager.facts.docs = [
        {"fact_id": "old", "project_id": "p1", "superseded_by": None,
         "learned_at": datetime(2023, 1, 1, tzinfo=timezone.utc)},
        {"fact_id": "new", "project_id": "p1", "superseded_by": None,
         "learned_at": datetime(2025, 1, 1, tzinfo=timezone.utc)},
    ]
    assert [f["fact_id"] for f in manager.list_facts("p1")] == ["new", "old"]


def test_a_hand_recorded_fact_with_no_key_still_inserts_normally():
    manager = _manager()
    manager.remember_fact(project_id="p1", text="Vendor is the incumbent.", origin="user")
    manager.remember_fact(project_id="p1", text="Vendor is the incumbent.", origin="user")
    assert len(manager.list_facts("p1")) == 2
