"""Tables reach extraction as rows, not as prose to be re-derived.

Ingestion already parses and classifies every table — 17 of them on the
reference SGHA Annex B, typed Rate Schedule / Tiered Pricing / SLA. Extraction
ignored all of it and reconstructed rows from the markdown flattened back into
20,000-character chunks. Measured cost of that round trip on one document:
`ramp_services` scored 8/8 while `support_services`, the same table type one
page later, scored 1/6 — and 15 of 41 records were duplicate readings of a row
already extracted.
"""

from unittest.mock import MagicMock

from services.kpi_manager import ContractKPIManager

TABLE_MARKDOWN = """
| DESCRIPTION | UNIT | PRICE | SGHA 2018 |
|---|---|---|---|
| GPU (GROUND POWER UNIT) | PER HOUR | 45.00 EUR | 3.6.1(a) |
| MARSHALLING | PER FLIGHT | FREE | 3.2.1(a) |
| PUSHBACK TRACTOR & CREW | PER OPERATION | 110.00 EUR | 3.9.2(a) |
"""


def _manager():
    return ContractKPIManager(database=MagicMock())


def test_markdown_rows_are_parsed_without_the_separator_line():
    rows = _manager()._markdown_table_rows(TABLE_MARKDOWN)

    assert rows[0] == ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"]
    assert len(rows) == 4, "header plus three data rows, no |---| separator"
    assert rows[2][2] == "FREE", "a non-numeric price is still a row"


def test_each_row_becomes_its_own_candidate_carrying_the_header(monkeypatch):
    manager = _manager()
    monkeypatch.setattr(
        "services.table_extraction.extract_tables",
        lambda content: [{
            "table_id": "table_5", "body": TABLE_MARKDOWN, "table_type": "Rate Schedule",
            "caption": "RAMP SERVICES", "page": 3, "signature": "abc", "char_start": 0, "char_end": 10,
        }],
    )

    candidates = manager._table_row_candidates({"_id": "c1", "index": {"content": "x"}})

    assert len(candidates) == 3
    assert all("DESCRIPTION | UNIT | PRICE" in c["text"] for c in candidates), (
        "a price is meaningless without its header when the row travels alone"
    )
    assert candidates[0]["chunk_level"] == "table_row"
    assert candidates[0]["table_type"] == "Rate Schedule"
    assert len({c["segment_id"] for c in candidates}) == 3, "rows need distinct ids to be accounted"


def test_furniture_tables_are_not_sent_for_extraction(monkeypatch):
    """A signature block is not a duty; its rows would spend calls for nothing."""
    manager = _manager()
    monkeypatch.setattr(
        "services.table_extraction.extract_tables",
        lambda content: [{
            "table_id": "table_17", "body": TABLE_MARKDOWN, "table_type": "Contact & Signature",
            "caption": "SIGNATURES", "page": 6, "signature": "z", "char_start": 0, "char_end": 1,
        }],
    )

    assert manager._table_row_candidates({"_id": "c1", "index": {"content": "x"}}) == []


def test_table_markup_is_removed_from_the_prose_that_carried_it():
    manager = _manager()
    text = "Charges are set out below.\n" + TABLE_MARKDOWN.strip() + "\nRates escalate annually."

    stripped = manager._strip_table_markup(text)

    assert "45.00 EUR" not in stripped, "the row is extracted separately; leaving it here duplicates it"
    assert "Charges are set out below." in stripped
    assert "Rates escalate annually." in stripped
    assert "table row(s) extracted separately" in stripped


def test_prose_without_a_table_is_untouched():
    manager = _manager()
    text = "The Handler shall provide marshalling at no charge."

    assert manager._strip_table_markup(text) == text


# ── duplicate collapse ─────────────────────────────────────────────────────


def test_two_readings_of_one_row_collapse_to_the_longer_quote():
    manager = _manager()
    items = [
        {"name": "Turnaround Rate <=3,000 kg", "value": 180, "unit": "EUR", "currency": "EUR",
         "quote": "180.00 EUR", "measurement": {"threshold": 180, "measurement_scope": "MTOW <= 3,000 kg"}},
        {"name": "Turnaround Rate: <= 3,000 kg Ramp Marshalling", "value": 180, "unit": "EUR",
         "currency": "EUR", "quote": "| <= 3,000 kg | 180.00 EUR | Ramp marshalling, baggage offloading |",
         "measurement": {"threshold": 180, "measurement_scope": "MTOW <= 3,000 kg"}},
    ]

    result = manager._drop_duplicate_table_rows(items)

    assert len(result) == 1
    assert "Ramp marshalling" in result[0]["quote"], "the fuller reading survives"


def test_two_bands_sharing_a_price_stay_separate():
    """Scope is in the identity, or a schedule with a repeated price loses rows."""
    manager = _manager()
    items = [
        {"name": "A", "value": 500, "unit": "EUR", "measurement": {"threshold": 500, "measurement_scope": "Band 1"}},
        {"name": "B", "value": 500, "unit": "EUR", "measurement": {"threshold": 500, "measurement_scope": "Band 2"}},
    ]

    assert len(manager._drop_duplicate_table_rows(items)) == 2


def test_records_binding_nothing_are_left_alone():
    manager = _manager()
    items = [{"name": "Records retention duty", "value": None, "measurement": None} for _ in range(3)]

    assert len(manager._drop_duplicate_table_rows(items)) == 3
