"""A rate ladder is one obligation with bands, not N obligations.

The register showed eight "Turnaround Rate" records for one contract because
extraction unrolls table rows on purpose — a row read alone is the only reading
that survives batching. These tests cover the fold that puts them back, and in
particular the two ways it can be wrong: folding a table that holds unrelated
charges, and losing a row's number while folding one that doesn't.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[3] / "apps" / "intelligence"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.obligation_tiering import (  # noqa: E402
    LadderDecision,
    apply_ladders,
    build_tiers,
    find_ladder_groups,
    parse_decisions,
    render_adjudication_prompt,
)


def row(kpi_id, name, value, table="table_3", index=0, currency="EUR", unit=None):
    return {
        "kpi_id": kpi_id,
        "name": name,
        "value": value,
        "unit": unit,
        "currency": currency,
        "quote": f"{name} — {value}",
        "source_chunk_id": f"contract:{table}:r{index}",
    }


MTOW_ROWS = [
    row("k1", "Turnaround Rate: ≤3,000 kg MTOW", 180.0, index=0),
    row("k2", "Turnaround Rate: 3,001–20,000 kg MTOW", 420.0, index=1),
    row("k3", "Turnaround Rate: 20,001–60,000 kg MTOW", 850.0, index=2),
    row("k4", "Turnaround Rate: >60,000 kg MTOW", 1450.0, index=3),
]

TABLES = [{"table_id": "table_3", "table_type": "Tiered Pricing", "caption": "Turnaround Charges"}]


class TestGrouping:
    def test_table_rows_group_by_table(self):
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        assert len(groups) == 1
        assert groups[0].table_id == "table_3"
        assert groups[0].size == 4
        assert groups[0].table_type == "Tiered Pricing"

    def test_rows_are_ordered_by_row_index_not_arrival(self):
        shuffled = [MTOW_ROWS[2], MTOW_ROWS[0], MTOW_ROWS[3], MTOW_ROWS[1]]
        group = find_ladder_groups(shuffled, TABLES)[0]
        assert [item["value"] for item in group.members] == [180.0, 420.0, 850.0, 1450.0]

    def test_prose_records_are_never_grouped(self):
        """A paragraph listing four fees is four records and stays four."""
        prose = [
            {"kpi_id": f"p{i}", "name": f"Fee {i}", "source_chunk_id": "contract:voyage-chunk-2"}
            for i in range(4)
        ]
        assert find_ladder_groups(prose, []) == []

    def test_two_tables_stay_two_groups(self):
        other = [
            row("m1", "Liability Cap: Narrow-Body", 1500000, table="table_16", index=0),
            row("m2", "Liability Cap: Wide-Body", 3000000, table="table_16", index=1),
        ]
        groups = find_ladder_groups(MTOW_ROWS + other, TABLES)
        assert {group.table_id for group in groups} == {"table_3", "table_16"}

    def test_single_row_table_is_not_a_ladder(self):
        assert find_ladder_groups([MTOW_ROWS[0]], TABLES) == []


class TestTierLabels:
    def test_shared_prefix_is_stripped_from_the_band(self):
        tiers = build_tiers(find_ladder_groups(MTOW_ROWS, TABLES)[0])
        assert [tier["band"] for tier in tiers] == [
            "≤3,000 kg MTOW",
            "3,001–20,000 kg MTOW",
            "20,001–60,000 kg MTOW",
            ">60,000 kg MTOW",
        ]

    def test_row_codes_and_shared_suffix_are_stripped(self):
        """Coded rate cards repeat the metric at the end, not the front."""
        coded = [
            row("r1", "RATE-DM-01: Duty Manager Straight Time Rate", 45.0, table="table_9", index=0),
            row("r2", "RATE-RA-01: Ramp Agent Straight Time Rate", 28.0, table="table_9", index=1),
            row("r3", "RATE-BH-01: Baggage Handler Straight Time Rate", 24.0, table="table_9", index=2),
        ]
        group = find_ladder_groups(coded, [])[0]
        assert [tier["band"] for tier in build_tiers(group)] == [
            "Duty Manager",
            "Ramp Agent",
            "Baggage Handler",
        ]

    def test_a_row_whose_value_was_nulled_falls_back_to_its_text(self):
        """Extraction nulls `value` on rate rows whose unit reads as currency.
        Every MTOW band on the reference document came through the fold as
        `None` because of it, leaving four bands and no prices."""
        stripped = [
            {
                "kpi_id": "s1",
                "name": "Turnaround Rate: <=3,000 kg MTOW",
                "value": None,
                "currency": "EUR",
                "quote": "Turnaround Charges | <=3,000 kg MTOW | 180.00 EUR per turnaround",
                "source_chunk_id": "contract:table_3:r0",
            },
            {
                "kpi_id": "s2",
                "name": "Turnaround Rate: 20,001-60,000 kg MTOW",
                "value": None,
                "currency": "EUR",
                "quote": "Turnaround Charges | 20,001-60,000 kg MTOW | 850.00 EUR per turnaround",
                "source_chunk_id": "contract:table_3:r1",
            },
        ]
        tiers = build_tiers(find_ladder_groups(stripped, TABLES)[0])
        assert [tier["value"] for tier in tiers] == [180.0, 850.0]

    def test_measurement_threshold_is_preferred_over_the_text(self):
        item = {
            "kpi_id": "m1",
            "name": "Cap: Wide-Body",
            "value": None,
            "measurement": {"threshold": 3000000},
            "quote": "Wide-Body | 3,000,000 EUR per incident",
            "source_chunk_id": "contract:table_16:r0",
        }
        other = dict(item, kpi_id="m2", name="Cap: Narrow-Body", source_chunk_id="contract:table_16:r1")
        tiers = build_tiers(find_ladder_groups([item, other], [])[0])
        assert tiers[0]["value"] == 3000000.0

    def test_a_row_with_no_number_anywhere_stays_none(self):
        rows = [
            {"kpi_id": "n1", "name": "Included: Marshalling", "quote": "Marshalling — included",
             "source_chunk_id": "contract:table_2:r0"},
            {"kpi_id": "n2", "name": "Included: Chocks", "quote": "Chocks — included",
             "source_chunk_id": "contract:table_2:r1"},
        ]
        tiers = build_tiers(find_ladder_groups(rows, [])[0])
        assert [tier["value"] for tier in tiers] == [None, None]

    def test_every_row_value_survives_the_fold(self):
        tiers = build_tiers(find_ladder_groups(MTOW_ROWS, TABLES)[0])
        assert [tier["value"] for tier in tiers] == [180.0, 420.0, 850.0, 1450.0]
        assert all(tier["source_chunk_id"] for tier in tiers)
        assert [tier["source_kpi_id"] for tier in tiers] == ["k1", "k2", "k3", "k4"]


class TestApply:
    def _decision(self, is_ladder=True):
        return {
            "table_3": LadderDecision(
                table_id="table_3",
                is_ladder=is_ladder,
                name="Turnaround Handling Charge by MTOW Band",
                dimension="MTOW band",
                reason="one charge, four weight bands",
            )
        }

    def test_ladder_collapses_to_one_tiered_record(self):
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        folded, trail = apply_ladders(MTOW_ROWS, groups, self._decision(), contract_id="c1")
        assert len(folded) == 1
        record = folded[0]
        assert record["rule_type"] == "tiered"
        assert record["name"] == "Turnaround Handling Charge by MTOW Band"
        assert len(record["target_schedule"]) == 4
        assert record["collapsed_row_count"] == 4
        assert record["collapsed_from"] == ["k1", "k2", "k3", "k4"]
        assert trail[0]["collapsed"] is True

    def test_a_ladder_has_no_single_threshold(self):
        """One band's number standing in as the contract's target is how
        "≥3,000 kg" became the turnaround rate."""
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        folded, _ = apply_ladders(MTOW_ROWS, groups, self._decision(), contract_id="c1")
        assert folded[0]["value"] is None
        assert folded[0]["operator"] is None
        assert folded[0]["measurement"]["threshold"] is None

    def test_declining_to_fold_leaves_every_row_alone(self):
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        folded, trail = apply_ladders(
            MTOW_ROWS, groups, self._decision(is_ladder=False), contract_id="c1"
        )
        assert len(folded) == 4
        assert [item["kpi_id"] for item in folded] == ["k1", "k2", "k3", "k4"]
        assert trail[0]["collapsed"] is False
        assert trail[0]["reason"]

    def test_a_missing_decision_keeps_the_rows(self):
        """Silence is not consent: an unanswered table stays unrolled."""
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        folded, trail = apply_ladders(MTOW_ROWS, groups, {}, contract_id="c1")
        assert len(folded) == 4
        assert trail[0]["collapsed"] is False

    def test_records_outside_the_ladder_are_untouched(self):
        other = {"kpi_id": "z1", "name": "Insurance Certificate", "source_chunk_id": "contract:voyage-chunk-9"}
        items = MTOW_ROWS + [other]
        groups = find_ladder_groups(items, TABLES)
        folded, _ = apply_ladders(items, groups, self._decision(), contract_id="c1")
        assert len(folded) == 2
        assert any(item["kpi_id"] == "z1" for item in folded)

    def test_folded_id_is_stable_across_runs(self):
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        first, _ = apply_ladders(MTOW_ROWS, groups, self._decision(), contract_id="c1")
        second, _ = apply_ladders(MTOW_ROWS, groups, self._decision(), contract_id="c1")
        assert first[0]["kpi_id"] == second[0]["kpi_id"]

    def test_folded_id_differs_per_contract(self):
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        a, _ = apply_ladders(MTOW_ROWS, groups, self._decision(), contract_id="c1")
        b, _ = apply_ladders(MTOW_ROWS, groups, self._decision(), contract_id="c2")
        assert a[0]["kpi_id"] != b[0]["kpi_id"]


class TestDecisionParsing:
    def test_unknown_table_ids_are_ignored(self):
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        parsed = parse_decisions(
            {"ladders": [{"table_id": "table_99", "is_ladder": True, "name": "x"}]}, groups
        )
        assert parsed == {}

    def test_malformed_payloads_do_not_raise(self):
        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        for payload in (None, {}, {"ladders": None}, {"ladders": ["nope"]}, "text"):
            assert parse_decisions(payload, groups) == {}

    def test_prompt_carries_the_rows_and_the_table_type(self):
        prompt = render_adjudication_prompt(find_ladder_groups(MTOW_ROWS, TABLES), "Annex B")
        assert "table_3" in prompt
        assert "Tiered Pricing" in prompt
        assert "1450" in prompt
        assert "Annex B" in prompt


class TestSchemaRoundTrip:
    def test_a_folded_ladder_survives_the_v2_migration(self):
        """The migrator re-parses tiers from clause_text on every read. A
        folded record's clause_text is one member's quote, so an unguarded
        re-parse replaces the whole ladder with at most one band."""
        from services.kpi_schema import KPISchemaV1toV2Migrator

        groups = find_ladder_groups(MTOW_ROWS, TABLES)
        folded, _ = apply_ladders(
            MTOW_ROWS,
            groups,
            {
                "table_3": LadderDecision(
                    table_id="table_3", is_ladder=True, name="Turnaround Charge", dimension="MTOW"
                )
            },
            contract_id="c1",
        )
        record = dict(folded[0])
        record.update({"contract_id": "c1", "schema_version": 1, "clause_text": record["quote"]})

        migrated = KPISchemaV1toV2Migrator.migrate_doc(record)
        assert migrated["rule"]["rule_type"] == "tiered"
        assert len(migrated["rule"]["spec"]["tiers"]) == 4
        # Re-reading an already-migrated record must not shrink the ladder.
        again = KPISchemaV1toV2Migrator.migrate_doc(migrated)
        assert len(again["rule"]["spec"]["tiers"]) == 4

    def test_run_id_survives_migration(self):
        """Every record written since the trail shipped carried no run id."""
        from services.kpi_schema import KPISchemaV1toV2Migrator

        migrated = KPISchemaV1toV2Migrator.migrate_doc(
            {"kpi_id": "k1", "contract_id": "c1", "name": "X", "run_id": "kpi_run_abc", "schema_version": 1}
        )
        assert migrated["run_id"] == "kpi_run_abc"
