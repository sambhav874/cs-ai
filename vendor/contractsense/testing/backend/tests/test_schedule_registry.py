"""Resolving a schedule by name, and reading its rates as of a date.

No Mongo. `find_schedule` and `schedule_table` are pure functions over the
lineages the tracker builds, which is where the decisions worth testing are:
which schedule the user meant, and which version was in force.
"""

from services.schedule_registry import find_schedule, schedule_table


def lineage(caption, signature, versions):
    return {
        "caption": caption,
        "signature": signature,
        "table_type": "Rate Schedule",
        "versions": versions,
        "version_count": len(versions),
    }


def version(contract_id, name, effective, signature=None):
    return {
        "contract_id": contract_id,
        "contract_name": name,
        "effective_date": effective,
        "signature": signature or "sig-a",
    }


PASSENGER = lineage("PASSENGER SERVICES", "sig-p", [
    version("c1", "Base_2022.pdf", "2022-01-01", "sig-p"),
    version("c2", "Revision_2023.pdf", "2023-04-01", "sig-p"),
    version("c3", "Amendment_2024.pdf", "2024-10-01", "sig-p"),
])
RAMP = lineage("RAMP SERVICES", "sig-r", [version("c1", "Base_2022.pdf", "2022-01-01", "sig-r")])
DEICING = lineage("DE-ICING & ANTI-ICING SERVICES", "sig-d", [
    version("c1", "Base_2022.pdf", "2022-01-01", "sig-d"),
])

ALL = [PASSENGER, RAMP, DEICING]


# ------------------------------------------------------------------ naming


def test_a_partial_name_resolves_to_the_schedule():
    match, candidates = find_schedule(ALL, "passenger")
    assert match is PASSENGER
    assert candidates == []


def test_naming_is_case_and_punctuation_insensitive():
    match, _ = find_schedule(ALL, "de icing")
    assert match is DEICING


def test_an_exact_signature_always_wins():
    match, _ = find_schedule(ALL, "sig-r")
    assert match is RAMP


def test_an_ambiguous_name_returns_candidates_instead_of_a_guess():
    """Quoting the wrong rate card reads exactly like quoting the right one,
    so an ambiguous name has to come back as a question."""
    arrival = lineage("RAMP SERVICES ARRIVAL", "sig-r1", [version("c1", "A.pdf", "2022-01-01")])
    departure = lineage("RAMP SERVICES DEPARTURE", "sig-r2", [version("c1", "A.pdf", "2022-01-01")])

    match, candidates = find_schedule([arrival, departure], "ramp services")

    assert match is None
    assert {c["caption"] for c in candidates} == {
        "RAMP SERVICES ARRIVAL", "RAMP SERVICES DEPARTURE"
    }


def test_an_unmatched_name_offers_every_schedule():
    match, candidates = find_schedule(ALL, "catering trolleys")
    assert match is None
    assert len(candidates) == len(ALL)


def test_no_name_offers_every_schedule():
    match, candidates = find_schedule(ALL, "")
    assert match is None
    assert len(candidates) == len(ALL)


def test_no_schedules_at_all_is_not_a_match():
    assert find_schedule([], "passenger") == (None, [])


# ------------------------------------------------------------------ values


def _documents():
    return [
        ("c1", "Base_2022.pdf", "2022-01-01",
         [{"signature": "sig-p", "body": "| ITEM | PRICE |\n| A | 40.00 |", "page": 3}]),
        ("c2", "Revision_2023.pdf", "2023-04-01",
         [{"signature": "sig-p", "body": "| ITEM | PRICE |\n| A | 41.20 |", "page": 3}]),
        ("c3", "Amendment_2024.pdf", "2024-10-01",
         [{"signature": "sig-p", "body": "| ITEM | PRICE |\n| A | 38.00 |", "page": 2}]),
    ]


def test_the_current_version_is_the_last_one_to_take_effect():
    table = schedule_table(PASSENGER, _documents())
    assert "38.00" in table["body"]
    assert table["is_latest"] is True
    assert table["contract_name"] == "Amendment_2024.pdf"


def test_as_of_reads_the_version_that_was_in_force_then():
    table = schedule_table(PASSENGER, _documents(), as_of="2023-06-01")
    assert "41.20" in table["body"]
    assert table["is_latest"] is False
    assert table["effective_date"] == "2023-04-01"


def test_as_of_on_the_day_a_version_takes_effect_uses_that_version():
    table = schedule_table(PASSENGER, _documents(), as_of="2023-04-01")
    assert "41.20" in table["body"]


def test_as_of_the_day_before_uses_the_previous_version():
    table = schedule_table(PASSENGER, _documents(), as_of="2023-03-31")
    assert "40.00" in table["body"]


def test_a_date_before_every_version_has_nothing_in_force():
    assert schedule_table(PASSENGER, _documents(), as_of="2019-01-01") is None


def test_a_renamed_schedule_is_found_by_the_version_signature_not_the_lineage():
    """A confirmed rename keeps one lineage but the later version hashes to a
    different signature. Looking it up by the lineage's own signature would
    silently return nothing for exactly the schedules that were tracked
    hardest."""
    renamed = lineage("PASSENGER SERVICES", "sig-p", [
        version("c1", "Base.pdf", "2022-01-01", "sig-p"),
        version("c2", "Renamed.pdf", "2024-01-01", "sig-NEW"),
    ])
    documents = [
        ("c1", "Base.pdf", "2022-01-01", [{"signature": "sig-p", "body": "| A | 40.00 |"}]),
        ("c2", "Renamed.pdf", "2024-01-01", [{"signature": "sig-NEW", "body": "| A | 44.00 |"}]),
    ]

    table = schedule_table(renamed, documents)

    assert table is not None
    assert "44.00" in table["body"]


def test_a_lineage_with_no_versions_yields_nothing():
    assert schedule_table(lineage("EMPTY", "sig-e", []), _documents()) is None
