import os
import sys
import unittest
from pathlib import Path

APP_BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "backend"
sys.path.insert(0, str(APP_BACKEND_ROOT))

os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("FINAL_OUTPUT_DIR", "/tmp/extractor-test-output")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/test")

from services.table_tracking import compare_tables, diff_against_previous, is_trackable


def table(rows, *, signature="sig1", caption="RAMP SERVICES", table_type="Rate Schedule"):
    body = "\n".join([
        "| DESCRIPTION | UNIT | PRICE |",
        "| --- | --- | --- |",
        *[f"| {a} | {b} | {c} |" for a, b, c in rows],
    ])
    return {"signature": signature, "caption": caption, "table_type": table_type, "body": body}


BASE = table([
    ("GPU", "PER HOUR", "45.00 EUR"),
    ("ASU", "PER ATTEMPT", "120.00 EUR"),
    ("MARSHALLING", "PER FLIGHT", "FREE"),
])


class CompareTests(unittest.TestCase):
    def test_a_uniform_uplift_is_reported_as_one_rate(self) -> None:
        after = table([
            ("GPU", "PER HOUR", "49.50 EUR"),
            ("ASU", "PER ATTEMPT", "132.00 EUR"),
            ("MARSHALLING", "PER FLIGHT", "FREE"),
        ])
        diff = compare_tables(BASE, after)
        self.assertEqual(diff["observed_pct"], 10.0)
        self.assertEqual(diff["priced_cells"], 2)
        self.assertEqual(diff["changed_rows"], 2)
        self.assertEqual(diff["unchanged_rows"], 1)

    def test_the_rate_is_derived_not_assumed(self) -> None:
        """Any escalation works; nothing in here knows about a particular one."""
        for pct, price in ((3.0, "46.35 EUR"), (10.0, "49.50 EUR"), (25.0, "56.25 EUR")):
            after = table([("GPU", "PER HOUR", price),
                           ("ASU", "PER ATTEMPT", "120.00 EUR"),
                           ("MARSHALLING", "PER FLIGHT", "FREE")])
            self.assertEqual(compare_tables(BASE, after)["priced_cells"], 1)
            self.assertAlmostEqual(compare_tables(BASE, after)["observed_pct"], pct, places=2)

    def test_individually_repriced_rows_are_not_called_an_indexation(self) -> None:
        after = table([
            ("GPU", "PER HOUR", "60.00 EUR"),
            ("ASU", "PER ATTEMPT", "125.00 EUR"),
            ("MARSHALLING", "PER FLIGHT", "FREE"),
        ])
        diff = compare_tables(BASE, after)
        self.assertIsNone(diff["observed_pct"])
        self.assertIsNone(diff["uniform_ratio"])

    def test_rounding_does_not_break_a_uniform_uplift(self) -> None:
        """Per-line rounding moves small values proportionally more than large."""
        before = table([("A", "X", "10.00 EUR"), ("B", "X", "999.00 EUR")])
        after = table([("A", "X", "10.30 EUR"), ("B", "X", "1028.97 EUR")])
        self.assertIsNotNone(compare_tables(before, after)["observed_pct"])

    def test_added_and_removed_rows_are_reported(self) -> None:
        after = table([
            ("GPU", "PER HOUR", "45.00 EUR"),
            ("MARSHALLING", "PER FLIGHT", "FREE"),
            ("DE-ICING", "PER LITRE", "3.00 EUR"),
        ])
        diff = compare_tables(BASE, after)
        self.assertEqual(diff["added_rows"], 1)
        self.assertEqual(diff["removed_rows"], 1)

    def test_a_reissue_with_no_edits_reports_nothing_changed(self) -> None:
        diff = compare_tables(BASE, BASE)
        self.assertEqual((diff["changed_rows"], diff["added_rows"], diff["removed_rows"]), (0, 0, 0))


class TrackabilityTests(unittest.TestCase):
    def test_only_commercially_meaningful_kinds_are_compared(self) -> None:
        self.assertTrue(is_trackable("Rate Schedule"))
        self.assertFalse(is_trackable("Contact & Signature"))
        self.assertFalse(is_trackable("Contract Metadata"))
        self.assertFalse(is_trackable("Not A Table"))

    def test_an_unclassified_table_is_still_tracked(self) -> None:
        """Classification is advisory; dropping a rate card for a missing label
        is worse than reporting one change too many."""
        self.assertTrue(is_trackable(None))
        self.assertTrue(is_trackable(""))


class LineageTests(unittest.TestCase):
    def test_a_schedule_matches_its_later_revision_by_signature(self) -> None:
        after = table([("GPU", "PER HOUR", "49.50 EUR"),
                       ("ASU", "PER ATTEMPT", "132.00 EUR"),
                       ("MARSHALLING", "PER FLIGHT", "FREE")])
        [result] = diff_against_previous([after], [("c1", "A.pdf", [BASE])])
        self.assertEqual(result["status"], "revised")
        self.assertEqual(result["observed_pct"], 10.0)
        self.assertEqual(result["previous_contract_id"], "c1")
        self.assertEqual(result["severity"], "info")

    def test_it_compares_against_the_most_recent_version_not_the_first(self) -> None:
        mid = table([("GPU", "PER HOUR", "49.50 EUR"), ("ASU", "PER ATTEMPT", "132.00 EUR"),
                     ("MARSHALLING", "PER FLIGHT", "FREE")])
        latest = table([("GPU", "PER HOUR", "54.45 EUR"), ("ASU", "PER ATTEMPT", "145.20 EUR"),
                        ("MARSHALLING", "PER FLIGHT", "FREE")])
        [result] = diff_against_previous(
            [latest], [("c1", "A.pdf", [BASE]), ("c2", "B.pdf", [mid])]
        )
        self.assertEqual(result["previous_contract_id"], "c2")
        self.assertEqual(result["observed_pct"], 10.0)

    def test_a_schedule_with_no_predecessor_is_not_forced_onto_one(self) -> None:
        """DESCRIPTION/UNIT/PRICE is common enough that unrelated schedules share
        it — header overlap alone must not be enough to link them. The captions
        differ ("DE-ICING SERVICES" vs "RAMP SERVICES"), which is what actually
        keeps a de-icing schedule from being fuzzy-matched onto a ramp one."""
        other = table([("DE-ICING", "PER LITRE", "3.00 EUR")], signature="sig-new",
                      caption="DE-ICING SERVICES")
        [result] = diff_against_previous([other], [("c1", "A.pdf", [BASE])])
        self.assertEqual(result["status"], "new")
        self.assertNotIn("previous_contract_id", result)

    def test_a_renamed_column_is_offered_as_a_possible_match_not_dropped(self) -> None:
        """The corpus case that motivated this: a real revision renames one
        column ("SGHA 2018" -> "SGHA Ref"), which changes the signature even
        though it is still the same schedule. Reporting it as unrelated "new"
        would be wrong but visible; a signature miss with no fallback drops the
        lineage with no trace at all, which is worse."""
        renamed = table([
            ("GPU", "PER HOUR", "49.50 EUR"),
            ("ASU", "PER ATTEMPT", "132.00 EUR"),
            ("MARSHALLING", "PER FLIGHT", "FREE"),
        ], signature="sig-renamed")
        renamed["body"] = renamed["body"].replace("PRICE", "PRICE ")  # same header set, still same caption
        [result] = diff_against_previous([renamed], [("c1", "A.pdf", [BASE])])
        self.assertEqual(result["status"], "possible_match")
        self.assertEqual(result["previous_contract_id"], "c1")
        self.assertEqual(result["severity"], "warning")
        self.assertGreaterEqual(result["header_similarity"], 0.5)

    def test_row_churn_is_raised_above_a_plain_uplift(self) -> None:
        after = table([("GPU", "PER HOUR", "49.50 EUR"), ("ASU", "PER ATTEMPT", "132.00 EUR")])
        [result] = diff_against_previous([after], [("c1", "A.pdf", [BASE])])
        self.assertEqual(result["severity"], "warning")
        self.assertEqual(result["removed_rows"], 1)

    def test_non_trackable_tables_produce_no_finding(self) -> None:
        contact = table([("Name", "X", "Y")], signature="sig-c", caption="Contacts",
                        table_type="Contact & Signature")
        self.assertEqual(diff_against_previous([contact], [("c1", "A.pdf", [contact])]), [])

    def test_detail_rows_are_capped_but_the_count_is_kept(self) -> None:
        many = [(f"SERVICE {i}", "PER USE", f"{i + 1}.00 EUR") for i in range(40)]
        before = table(many)
        after = table([(n, u, f"{float(p.split()[0]) * 2:.2f} EUR") for n, u, p in many])
        [result] = diff_against_previous([after], [("c1", "A.pdf", [before])])
        self.assertEqual(len(result["changes"]), 20)
        self.assertEqual(result["changes_truncated"], 20)


if __name__ == "__main__":
    unittest.main()


class LineageBuildingTests(unittest.TestCase):
    def _doc(self, contract_id, name, date, rows, signature="sig1"):
        return (contract_id, name, date, [table(rows, signature=signature)])

    def test_versions_are_grouped_into_one_schedule_in_date_order(self) -> None:
        from services.table_tracking import build_lineages

        [lineage] = build_lineages([
            self._doc("c1", "A.pdf", "2022-04-01", [("GPU", "PER HOUR", "45.00 EUR")]),
            self._doc("c2", "B.pdf", "2023-04-01", [("GPU", "PER HOUR", "49.50 EUR")]),
            self._doc("c3", "C.pdf", "2024-04-01", [("GPU", "PER HOUR", "54.45 EUR")]),
        ])
        self.assertEqual(lineage["version_count"], 3)
        self.assertEqual([v["effective_date"] for v in lineage["versions"]],
                         ["2022-04-01", "2023-04-01", "2024-04-01"])
        self.assertEqual([v["status"] for v in lineage["versions"]],
                         ["new", "revised", "revised"])

    def test_percentages_compound_rather_than_sum(self) -> None:
        """+3%, +3% then back down is a return to the start, not +0.26%."""
        from services.table_tracking import build_lineages

        [lineage] = build_lineages([
            self._doc("c1", "A.pdf", "2022-04-01", [("GPU", "PER HOUR", "100.00 EUR")]),
            self._doc("c2", "B.pdf", "2023-04-01", [("GPU", "PER HOUR", "103.00 EUR")]),
            self._doc("c3", "C.pdf", "2024-04-01", [("GPU", "PER HOUR", "106.09 EUR")]),
        ])
        self.assertEqual(lineage["total_pct"], 6.09)

    def test_a_reverted_schedule_reports_no_net_change(self) -> None:
        from services.table_tracking import build_lineages

        [lineage] = build_lineages([
            self._doc("c1", "A.pdf", "2022-04-01", [("GPU", "PER HOUR", "100.00 EUR")]),
            self._doc("c2", "B.pdf", "2023-04-01", [("GPU", "PER HOUR", "110.00 EUR")]),
            self._doc("c3", "C.pdf", "2024-04-01", [("GPU", "PER HOUR", "100.00 EUR")]),
        ])
        self.assertAlmostEqual(lineage["total_pct"], 0.0, places=1)

    def test_unrelated_schedules_stay_separate(self) -> None:
        from services.table_tracking import build_lineages

        lineages = build_lineages([
            ("c1", "A.pdf", "2022-04-01", [
                table([("GPU", "PER HOUR", "45.00 EUR")], signature="sig-ramp", caption="RAMP"),
                table([("DEICE", "PER LITRE", "3.00 EUR")], signature="sig-ice", caption="DE-ICING"),
            ]),
        ])
        self.assertEqual(len(lineages), 2)
        self.assertEqual({l["version_count"] for l in lineages}, {1})

    def test_a_schedule_needing_review_sorts_first(self) -> None:
        from services.table_tracking import build_lineages

        lineages = build_lineages([
            ("c1", "A.pdf", "2022-04-01", [
                table([("GPU", "PER HOUR", "45.00 EUR")], signature="sig-a", caption="CLEAN"),
                table([("X", "PER USE", "1.00 EUR")], signature="sig-b", caption="CHURN"),
            ]),
            ("c2", "B.pdf", "2023-04-01", [
                table([("GPU", "PER HOUR", "46.35 EUR")], signature="sig-a", caption="CLEAN"),
                table([("Y", "PER USE", "2.00 EUR")], signature="sig-b", caption="CHURN"),
            ]),
        ])
        self.assertTrue(lineages[0]["needs_review"])
        self.assertEqual(lineages[0]["caption"], "CHURN")

    def test_non_trackable_kinds_never_become_a_lineage(self) -> None:
        from services.table_tracking import build_lineages

        self.assertEqual(build_lineages([
            ("c1", "A.pdf", "2022-04-01", [
                table([("Name", "X", "Y")], signature="sig-c", caption="Contacts",
                      table_type="Contact & Signature"),
            ]),
        ]), [])


class ValueParsingTests(unittest.TestCase):
    """A project can be denominated in anything; the comparison must not assume."""

    def test_currencies_beyond_the_ones_this_corpus_happens_to_use(self) -> None:
        from services.table_tracking import parse_value

        for raw in ("45.00 EUR", "€ 45", "$1,234.56", "CHF 99.90", "¥12,000", "₹ 2,50,000", "£10"):
            parsed = parse_value(raw)
            self.assertIsNotNone(parsed, raw)
            self.assertEqual(parsed[1], "currency", raw)

    def test_both_decimal_conventions_read_as_the_same_amount(self) -> None:
        """1,234.56 and 1.234,56 differ by three orders of magnitude if guessed wrong."""
        from services.table_tracking import parse_value

        self.assertEqual(parse_value("$1,234.56")[0], parse_value("1.234,56 EUR")[0])

    def test_indian_digit_grouping(self) -> None:
        from services.table_tracking import parse_value

        self.assertEqual(int(parse_value("₹ 2,50,000")[0]), 250000)
        self.assertEqual(int(parse_value("12,50,00,000")[0]), 125000000)

    def test_percentages_are_a_different_kind_from_prices(self) -> None:
        from services.table_tracking import parse_value

        self.assertEqual(parse_value("5.25%")[1], "percent")
        self.assertEqual(parse_value("8")[1], "number")

    def test_contract_words_are_not_numbers(self) -> None:
        from services.table_tracking import parse_value

        for raw in ("FREE", "n/a", "at cost", "on request", "centralized", "PER FLIGHT", "—"):
            self.assertIsNone(parse_value(raw), raw)

    def test_negatives_in_either_notation(self) -> None:
        from services.table_tracking import parse_value

        self.assertEqual(parse_value("-45.00")[0], parse_value("(45.00)")[0])

    def test_a_percentage_levy_does_not_break_a_uniform_uplift(self) -> None:
        """A fee rising 10% beside a levy fixed at a percentage is still uniform."""
        before = table([("GPU", "PER HOUR", "100.00 EUR"), ("Levy", "OF REVENUE", "5.25%")])
        after = table([("GPU", "PER HOUR", "110.00 EUR"), ("Levy", "OF REVENUE", "6.00%")])
        self.assertEqual(compare_tables(before, after)["observed_pct"], 10.0)

    def test_individually_repriced_rows_report_their_range(self) -> None:
        before = table([("A", "X", "1,500,000 EUR"), ("B", "X", "3,000,000 EUR")])
        after = table([("A", "X", "2,000,000 EUR"), ("B", "X", "4,500,000 EUR")])
        diff = compare_tables(before, after)
        self.assertIsNone(diff["observed_pct"])
        self.assertEqual(diff["spread_pct"], (33.33, 50.0))


class NamingTests(unittest.TestCase):
    def test_a_banner_caption_wins(self) -> None:
        from services.table_tracking import describe_table

        self.assertEqual(describe_table(table([("A", "B", "C")], caption="RAMP SERVICES")), "RAMP SERVICES")

    def test_an_untitled_table_falls_back_to_its_heading(self) -> None:
        """Better than a row of raw pipes in a list somebody has to scan."""
        from services.table_tracking import describe_table

        t = table([("A", "B", "C")], caption=None)
        t["section_path"] = "PARAGRAPH 11 - LIMIT OF LIABILITY"
        self.assertEqual(describe_table(t), "PARAGRAPH 11 - LIMIT OF LIABILITY")

    def test_with_neither_it_uses_the_columns(self) -> None:
        from services.table_tracking import describe_table

        t = table([("A", "B", "C")], caption=None)
        self.assertEqual(describe_table(t), "DESCRIPTION · UNIT · PRICE")


class LinkDecisionTests(unittest.TestCase):
    def _pair(self):
        old = table([("GPU", "PER HOUR", "100.00 EUR")], signature="sig-old")
        new = table([("GPU", "PER HOUR", "110.00 EUR")], signature="sig-new")
        return old, new, [("c1", "A.pdf", [old])]

    def test_without_a_decision_the_link_is_only_proposed(self) -> None:
        old, new, history = self._pair()
        [result] = diff_against_previous([new], history)
        self.assertEqual(result["status"], "possible_match")
        self.assertEqual(result["previous_signature"], "sig-old")

    def test_confirming_turns_it_into_a_measured_revision(self) -> None:
        from services.table_tracking import link_key

        old, new, history = self._pair()
        [result] = diff_against_previous([new], history, {link_key("sig-old", "sig-new"): "confirmed"})
        self.assertEqual(result["status"], "revised")
        self.assertEqual(result["observed_pct"], 10.0)
        self.assertTrue(result["link_confirmed"])

    def test_rejecting_leaves_the_schedule_standing_alone(self) -> None:
        from services.table_tracking import link_key

        old, new, history = self._pair()
        [result] = diff_against_previous([new], history, {link_key("sig-old", "sig-new"): "rejected"})
        self.assertEqual(result["status"], "new")

    def test_a_confirmed_link_merges_the_two_histories(self) -> None:
        from services.table_tracking import build_lineages, link_key

        old = table([("GPU", "PER HOUR", "100.00 EUR")], signature="sig-old")
        new = table([("GPU", "PER HOUR", "110.00 EUR")], signature="sig-new")
        documents = [("c1", "A.pdf", "2022-01-01", [old]), ("c2", "B.pdf", "2023-01-01", [new])]

        self.assertEqual(len(build_lineages(documents)), 2)
        [merged] = build_lineages(documents, {link_key("sig-old", "sig-new"): "confirmed"})
        self.assertEqual(merged["version_count"], 2)
        self.assertEqual(merged["total_pct"], 10.0)


def test_a_confirmed_link_clears_the_review_flag():
    """The flag has to come down when a person resolves the link.

    A lineage the user has already confirmed that still shows "needs review"
    puts a permanent badge on the one thing they went and fixed, which is how
    a warning stops meaning anything.
    """
    from services.table_tracking import build_lineages

    tables_v1 = [{
        "signature": "sig-1", "caption": "RAMP SERVICES", "table_type": "Rate Schedule",
        "body": "| DESCRIPTION | PRICE |\n| --- | --- |\n| TOWING | 100.00 EUR |",
        "rows": 1, "cols": 2, "page": 1,
    }]
    # Same schedule, renamed column: the matcher can only call this a possible
    # match, which is the case a person is asked to resolve.
    tables_v2 = [{
        "signature": "sig-2", "caption": "RAMP SERVICES", "table_type": "Rate Schedule",
        "body": "| DESCRIPTION | RATE |\n| --- | --- |\n| TOWING | 103.00 EUR |",
        "rows": 1, "cols": 2, "page": 1,
    }]
    documents = [
        ("c1", "Base_2022.pdf", "2022-04-01", tables_v1),
        ("c2", "Revision_2023.pdf", "2023-04-01", tables_v2),
    ]

    unresolved = build_lineages(documents)
    assert any(l["needs_review"] for l in unresolved)

    confirmed = build_lineages(documents, {"sig-1->sig-2": "confirmed"})
    assert len(confirmed) == 1
    assert confirmed[0]["version_count"] == 2
    assert confirmed[0]["needs_review"] is False
