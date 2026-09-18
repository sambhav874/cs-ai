import os
import sys
import unittest
from pathlib import Path

APP_BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "intelligence"
sys.path.insert(0, str(APP_BACKEND_ROOT))

os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("FINAL_OUTPUT_DIR", "/tmp/extractor-test-output")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/test")

from services.project_memory import _parse_effective_date


class EffectiveDateTests(unittest.TestCase):
    def test_the_forms_contracts_actually_use(self) -> None:
        """Every one of these came out of the AHM 810 corpus verbatim."""
        for raw, expected in (
            ("01 April 2022", "2022-04-01"),
            ("2023-04-01", "2023-04-01"),
            ("01 October 2024", "2024-10-01"),
            ("2025-04-01", "2025-04-01"),
            ("May 16, 2014", "2014-05-16"),
            ("1st June 2022", "2022-06-01"),
        ):
            self.assertEqual(_parse_effective_date(raw), expected, raw)

    def test_an_iso_date_is_never_reinterpreted_day_first(self) -> None:
        """Regression: dayfirst parsing turned 2023-04-01 into 4 January."""
        self.assertEqual(_parse_effective_date("2023-04-01"), "2023-04-01")
        self.assertEqual(_parse_effective_date("2024-10-05"), "2024-10-05")

    def test_ambiguous_slash_dates_read_day_first(self) -> None:
        """These contracts are IATA/European, where 01/06 is 1 June."""
        self.assertEqual(_parse_effective_date("01/06/2022"), "2022-06-01")

    def test_a_date_embedded_in_a_sentence_is_still_found(self) -> None:
        self.assertEqual(_parse_effective_date("effective from 15 March 2025"), "2025-03-15")

    def test_things_that_are_not_dates_return_nothing(self) -> None:
        for raw in ("Annex B 1.0", "n/a", "not stated", "", None, "   "):
            self.assertIsNone(_parse_effective_date(raw), repr(raw))

    def test_an_impossible_date_is_rejected_rather_than_coerced(self) -> None:
        self.assertIsNone(_parse_effective_date("2023-13-45"))

    def test_a_year_out_of_contract_range_is_rejected(self) -> None:
        """Document identifiers like "Annex 1.0" otherwise parse as a year."""
        self.assertIsNone(_parse_effective_date("1.0"))
        self.assertIsNone(_parse_effective_date("3500"))


if __name__ == "__main__":
    unittest.main()
