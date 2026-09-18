import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

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

from services.table_classification import (
    TABLE_CATEGORIES,
    TRACKABLE_CATEGORIES,
    classify_tables,
    merge_classifications,
)
from services.table_extraction import (
    content_hash,
    extract_tables,
    normalize_table_markers,
    table_signature,
)

FUSED = (
    "--- Page 2 ---\n\n#### PARAGRAPH 1 - CHARGES\n\n"
    "<!--TABLE:START id=t1 rows=6 cols=4-->\n"
    "| A/C MTOW up to | BASIC HANDLING | (in EUR) | |\n"
    "| --- | --- | --- | --- |\n"
    "| 3000kg | 100.00 | | |\n"
    "| | | | |\n"
    "| RAMP | SERVICES | | |\n"
    "| DESCRIPTION | UNIT | PRICE | SGHA 2013 |\n"
    "| MARSHALLING | PER FLIGHT | FREE | 3.2.1(a) |\n"
    "<!--TABLE:END id=t1-->"
)


class _Reply:
    def __init__(self, content):
        self.content = content


class _Model:
    def __init__(self, content):
        self._content = content
        self.calls = 0

    def invoke(self, _messages):
        self.calls += 1
        return _Reply(self._content)


class NormalizationTests(unittest.TestCase):
    def test_a_fused_sentinel_becomes_one_sentinel_per_table(self) -> None:
        normalized = normalize_table_markers(FUSED)
        self.assertEqual(FUSED.count("<!--TABLE:START"), 1)
        self.assertEqual(normalized.count("<!--TABLE:START"), 2)
        self.assertIn('caption="RAMP SERVICES"', normalized)

    def test_normalizing_twice_changes_nothing(self) -> None:
        once = normalize_table_markers(FUSED)
        self.assertEqual(once, normalize_table_markers(once))

    def test_signatures_survive_normalization(self) -> None:
        once = normalize_table_markers(FUSED)
        first = [table["signature"] for table in extract_tables(once)]
        second = [table["signature"] for table in extract_tables(normalize_table_markers(once))]
        self.assertEqual(first, second)

    def test_stamping_a_label_does_not_resplit_or_rehash(self) -> None:
        normalized = normalize_table_markers(FUSED)
        before = extract_tables(normalized)
        labels = {table["signature"]: "Rate Schedule" for table in before}
        stamped = normalize_table_markers(normalized, labels)
        after = extract_tables(stamped)
        self.assertEqual([t["signature"] for t in after], [t["signature"] for t in before])
        self.assertEqual([t["table_type"] for t in after], ["Rate Schedule"] * len(before))

    def test_a_document_with_no_tables_is_untouched(self) -> None:
        plain = "--- Page 1 ---\n\n# Heading\n\nprose only"
        self.assertEqual(normalize_table_markers(plain), plain)


class SignatureTests(unittest.TestCase):
    def test_reissued_values_keep_the_schedule_identity(self) -> None:
        """The point of the signature: a 2024 rate card matches its 2022 self."""
        header = ["Service", "Price"]
        self.assertEqual(
            table_signature(header, "RAMP SERVICES"),
            table_signature(header, "ramp  services"),
        )

    def test_a_different_schedule_gets_a_different_identity(self) -> None:
        self.assertNotEqual(
            table_signature(["Service", "Price"], "RAMP SERVICES"),
            table_signature(["Service", "Price"], "SUPPORT SERVICES"),
        )

    def test_content_hash_separates_a_real_change_from_a_re_upload(self) -> None:
        body = "| Service | Price |\n| --- | --- |\n| GPU | 45 |"
        self.assertEqual(content_hash(body), content_hash(body.replace(" | ", "  |  ")))
        self.assertNotEqual(content_hash(body), content_hash(body.replace("45", "50")))


class ClassificationTests(unittest.TestCase):
    def _tables(self):
        return extract_tables(normalize_table_markers(FUSED))

    def test_labels_are_attached_by_signature(self) -> None:
        tables = self._tables()
        reply = '[{"index":0,"category":"Rate Schedule","confidence":0.9},' \
                '{"index":1,"category":"Rate Schedule","confidence":0.8}]'
        with patch("services.contract_agent.graph.model_factory.build_chat_model",
                   return_value=_Model(reply)):
            records = classify_tables(tables)
        self.assertEqual(len(records), 2)
        self.assertEqual({r["signature"] for r in records}, {t["signature"] for t in tables})
        self.assertTrue(all(r["trackable"] for r in records))

    def test_an_invented_category_is_discarded_not_stored(self) -> None:
        """A free-text label would silently break every filter reading the field."""
        reply = '[{"index":0,"category":"Definitely A Rate Card","confidence":0.99}]'
        with patch("services.contract_agent.graph.model_factory.build_chat_model",
                   return_value=_Model(reply)):
            self.assertEqual(classify_tables(self._tables()), [])

    def test_out_of_range_indexes_are_ignored(self) -> None:
        reply = '[{"index":99,"category":"Rate Schedule","confidence":0.9}]'
        with patch("services.contract_agent.graph.model_factory.build_chat_model",
                   return_value=_Model(reply)):
            self.assertEqual(classify_tables(self._tables()), [])

    def test_confidence_is_clamped(self) -> None:
        reply = '[{"index":0,"category":"Rate Schedule","confidence":7}]'
        with patch("services.contract_agent.graph.model_factory.build_chat_model",
                   return_value=_Model(reply)):
            self.assertEqual(classify_tables(self._tables())[0]["classification_confidence"], 1.0)

    def test_every_failure_mode_degrades_instead_of_raising(self) -> None:
        """Classification is advisory; it must never be able to fail an ingestion."""
        tables = self._tables()
        with patch("services.contract_agent.graph.model_factory.build_chat_model", return_value=None):
            self.assertEqual(classify_tables(tables), [])
        with patch("services.contract_agent.graph.model_factory.build_chat_model",
                   side_effect=RuntimeError("no api key")):
            self.assertEqual(classify_tables(tables), [])
        with patch("services.contract_agent.graph.model_factory.build_chat_model",
                   return_value=_Model("the model apologises and returns prose")):
            self.assertEqual(classify_tables(tables), [])
        with patch("services.contract_agent.graph.model_factory.build_chat_model",
                   return_value=_Model('[{"index":0,"category":')):
            self.assertEqual(classify_tables(tables), [])
        self.assertEqual(classify_tables([]), [])

    def test_only_trackable_kinds_are_marked_trackable(self) -> None:
        self.assertIn("Rate Schedule", TRACKABLE_CATEGORIES)
        self.assertNotIn("Not A Table", TRACKABLE_CATEGORIES)
        self.assertNotIn("Contact & Signature", TRACKABLE_CATEGORIES)
        self.assertTrue(TRACKABLE_CATEGORIES.issubset(set(TABLE_CATEGORIES)))

    def test_a_hand_set_label_is_never_overwritten_by_a_rerun(self) -> None:
        existing = [{"signature": "s1", "table_type": "Rate Schedule", "source": "user"}]
        fresh = [
            {"signature": "s1", "table_type": "Not A Table", "source": "llm"},
            {"signature": "s2", "table_type": "Liability Limit", "source": "llm"},
        ]
        merged = {r["signature"]: r for r in merge_classifications(existing, fresh)}
        self.assertEqual(merged["s1"]["table_type"], "Rate Schedule")
        self.assertEqual(merged["s1"]["source"], "user")
        self.assertEqual(merged["s2"]["table_type"], "Liability Limit")


if __name__ == "__main__":
    unittest.main()
