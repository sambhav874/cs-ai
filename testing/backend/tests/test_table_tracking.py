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
        other = table([("DE-ICING", "PER LITRE", "3.00 EUR")], signature="sig-new",
                      caption="DE-ICING SERVICES")
        [result] = diff_against_previous([other], [("c1", "A.pdf", [BASE])])
        self.assertEqual(result["status"], "new")
        self.assertNotIn("previous_contract_id", result)

    def test_a_severed_signature_reads_as_new_rather_than_a_silent_gap(self) -> None:
        """A renamed column changes the signature. Reporting the schedule as new
        is wrong but visible; dropping it would be wrong and invisible."""
        renamed = table([("GPU", "PER HOUR", "49.50 EUR")], signature="sig-renamed")
        [result] = diff_against_previous([renamed], [("c1", "A.pdf", [BASE])])
        self.assertEqual(result["status"], "new")

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
