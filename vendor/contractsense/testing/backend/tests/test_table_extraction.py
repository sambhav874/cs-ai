import os
import re
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

from services.table_extraction import extract_tables, merge_stored_metadata


CLEAN_TABLE = (
    "| Aircraft Type | Limit (per incident) |\n"
    "| --- | --- |\n"
    "| Up to 6.000kg | 25.000 USD |"
)

# The real AOPA page-2 grid: three tables fused by liteparse, separated by a
# blank row and by a repeated header.
FUSED_TABLE = (
    "| A/C MTOW up to | BASIC HANDLING | (in EUR) | |\n"
    "| --- | --- | --- | --- |\n"
    "| 3000kg | 100.00 | | |\n"
    "| | | | |\n"
    "| RAMP | SERVICES | | |\n"
    "| DESCRIPTION | UNIT | PRICE | SGHA 2013 |\n"
    "| MARSHALLING | PER FLIGHT | FREE | 3.2.1(a) |\n"
    "| GPU (GROUND POWER UNIT) | PER 30 MIN | € 45 | 3..4.1(a)(c)(1) |\n"
    "| SUPPORT | SERVICES | | |\n"
    "| DESCRIPTION | UNIT | PRICE | SGHA 2013 |\n"
    "| IFR SLOT MANAGEMENT REQUEST | PER FLIGHT | € 45 | 1.4.5 |"
)

# The real AOPA page-4 contact table. Its second line is a wrapped continuation
# of the header, not a banner — splitting there would discard the header row.
WRAPPED_HEADER_TABLE = (
    "| AIRCRAFT OWNERS AND PILOTS | SWISSPORT HELLAS SUD SA |\n"
    "| --- | --- |\n"
    "| ASSOCIATION HELLAS | |\n"
    "| Contact Name: Mr. Kyprianos Biris | Contact Name: Mr. Ioannis Zermas |"
)


def _wrap(body: str, ordinal: int, rows: int, cols: int) -> str:
    return f"<!--TABLE:START id=t{ordinal} rows={rows} cols={cols}-->\n{body}\n<!--TABLE:END id=t{ordinal}-->"


CONTRACT = (
    "--- Page 1 ---\n\n# MASTER AGREEMENT\n\nProse, not a table.\n\n"
    "--- Page 2 ---\n\n#### PARAGRAPH 1 - CHARGES\n\n" + _wrap(FUSED_TABLE, 1, 9, 4) + "\n\n"
    "--- Page 4 ---\n\n#### PARAGRAPH 9 - NOTIFICATION\n\n" + _wrap(WRAPPED_HEADER_TABLE, 2, 2, 2) + "\n\n"
    "--- Page 5 ---\n\n#### PARAGRAPH 11 - LIMIT OF LIABILITY\n\n" + _wrap(CLEAN_TABLE, 3, 1, 2)
)


def _cell_texts(markdown: str) -> set:
    """Every non-empty cell value in a markdown table, ignoring delimiter rows."""
    values = set()
    for line in markdown.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", c or "-") for c in cells):
            continue
        values.update(c for c in cells if c)
    return values


class TableExtractionTests(unittest.TestCase):
    def test_no_sentinels_yields_no_tables_rather_than_an_error(self) -> None:
        self.assertEqual(extract_tables(""), [])
        self.assertEqual(extract_tables("# Heading\n\nprose only"), [])
        # An unwrapped table is not picked up — only what ingestion marked counts.
        self.assertEqual(extract_tables(CLEAN_TABLE), [])

    def test_a_fused_grid_reports_every_logical_table(self) -> None:
        tables = extract_tables(CONTRACT)
        # 3 from the fused page-2 grid, plus the contact and liability tables.
        self.assertEqual(len(tables), 5)
        self.assertEqual([t["ordinal"] for t in tables], [1, 2, 3, 4, 5])
        self.assertEqual([t["page"] for t in tables], [2, 2, 2, 4, 5])
        self.assertEqual([t["source_ordinal"] for t in tables], [1, 1, 1, 2, 3])
        self.assertEqual([t["source_part_count"] for t in tables], [3, 3, 3, 1, 1])

    def test_split_recovers_banner_rows_as_captions(self) -> None:
        tables = extract_tables(CONTRACT)
        self.assertEqual([t["caption"] for t in tables[:3]], [None, "RAMP SERVICES", "SUPPORT SERVICES"])
        # A caption is lifted out of the rows, not left behind as data.
        self.assertNotIn("RAMP", _cell_texts(tables[1]["body"]))

    def test_each_split_table_keeps_its_own_header(self) -> None:
        tables = extract_tables(CONTRACT)
        self.assertEqual(tables[0]["body"].splitlines()[0], "| A/C MTOW up to | BASIC HANDLING | (in EUR) |")
        for table in tables[1:3]:
            self.assertEqual(table["body"].splitlines()[0], "| DESCRIPTION | UNIT | PRICE | SGHA 2013 |")

    def test_split_conserves_every_cell_value(self) -> None:
        """The split may regroup rows but must never lose a value."""
        tables = extract_tables(CONTRACT)
        produced = set()
        for table in tables:
            produced |= _cell_texts(table["body"])
            if table["caption"]:
                produced.update(table["caption"].split())
        expected = _cell_texts(FUSED_TABLE) | _cell_texts(WRAPPED_HEADER_TABLE) | _cell_texts(CLEAN_TABLE)
        missing = {value for value in expected if value not in produced and value not in "RAMP SERVICES SUPPORT"}
        self.assertEqual(missing, set())

    def test_a_wrapped_header_row_is_not_mistaken_for_a_banner(self) -> None:
        """Regression: splitting on the sparse row here discarded the header."""
        contact = extract_tables(CONTRACT)[3]
        self.assertEqual(contact["source_part_count"], 1)
        self.assertIsNone(contact["caption"])
        self.assertEqual(
            contact["body"].splitlines()[0],
            "| AIRCRAFT OWNERS AND PILOTS | SWISSPORT HELLAS SUD SA |",
        )
        self.assertIn("ASSOCIATION HELLAS", contact["body"])

    def test_columns_empty_in_every_row_are_dropped(self) -> None:
        first = extract_tables(CONTRACT)[0]
        self.assertEqual(first["cols"], 3)
        self.assertNotIn("| |", first["body"])

    def test_a_clean_table_is_left_alone(self) -> None:
        liability = extract_tables(CONTRACT)[4]
        self.assertEqual(liability["source_part_count"], 1)
        self.assertEqual(liability["rows"], 1)
        self.assertFalse(liability["diagnostics"]["possible_multi_table"])

    def test_stored_metadata_is_applied_only_to_unsplit_tables(self) -> None:
        tables = merge_stored_metadata(extract_tables(CONTRACT), [
            {"ordinal": 1, "table_type": "Fee Schedule", "classification_confidence": 0.9},
            {"ordinal": 3, "table_type": "Liability Clause", "classification_confidence": 0.95},
        ])
        # Sentinel 1 was split into three, so its stored record describes a grid
        # that no longer exists and must not be copied onto the parts.
        self.assertEqual([t["table_type"] for t in tables[:3]], [None, None, None])
        self.assertEqual(tables[4]["table_type"], "Liability Clause")

    def test_missing_stored_records_are_not_an_error(self) -> None:
        tables = extract_tables(CONTRACT)
        self.assertEqual(merge_stored_metadata(tables, None), tables)
        self.assertEqual(merge_stored_metadata(tables, []), tables)


if __name__ == "__main__":
    unittest.main()
