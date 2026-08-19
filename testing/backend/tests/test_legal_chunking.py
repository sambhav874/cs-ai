import logging
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

from services.contract_agent.rag import ContractRAGSystem, DocumentSegmenter
from services.contract_agent.rag.segmentation import _split_table
from worker.tasks import _annotate_markdown_tables, _score_parse_quality


GOLDEN_CONTRACT = """--- Page 1 ---
# Catering Agreement

Section 4.02 Delivery Window
Meals must be delivered no earlier than 4 hours and no later than 90 minutes before departure.

Section 7. Payment
Customer shall pay invoices within thirty (30) days. Fees are set in the Rate Card attached as Exhibit A.

--- Page 2 ---
Exhibit A Rate Card

Breakfast costs $12.50 per meal. Overtime support is billed at $80 per hour.
"""


class LegalChunkingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.segmenter = DocumentSegmenter()
        self.clean_text, self.segments = self.segmenter.segment_text_with_page_markers(GOLDEN_CONTRACT)

    def _rag_without_init(self) -> ContractRAGSystem:
        rag = object.__new__(ContractRAGSystem)
        rag.logger = logging.getLogger("test_legal_chunking")
        rag.segmenter = self.segmenter
        return rag

    def test_chunker_creates_graph_ready_legal_chunks(self) -> None:
        levels = {segment.chunk_level for segment in self.segments}
        self.assertIn("meso", levels)
        self.assertIn("micro", levels)

        payment_meso = next(segment for segment in self.segments if segment.chunk_level == "meso" and "Payment" in (segment.section_path or ""))
        self.assertEqual(payment_meso.page_start, 1)
        self.assertEqual(payment_meso.page_end, 1)
        self.assertIn("payment", payment_meso.section_tags)
        self.assertIn("Exhibit A", payment_meso.cross_refs)
        self.assertIn("Rate Card", " ".join(payment_meso.referenced_documents))

        money_micro = next(segment for segment in self.segments if "money" in segment.value_types)
        self.assertEqual(money_micro.chunk_level, "micro")
        self.assertEqual(money_micro.page_start, 2)
        self.assertTrue(money_micro.parent_chunk_id)

    def test_fact_retrieval_prefers_micro_and_meso_over_macro(self) -> None:
        rag = self._rag_without_init()
        prepared = rag._prepare_segments_for_document(
            self.segments,
            contract_id="contract-1",
            contract_name="Catering Agreement",
        )
        docs = rag._keyword_segment_documents(
            prepared,
            "payment deadlines and rate card fees",
            top_k=5,
        )

        self.assertGreaterEqual(len(docs), 3)
        top_levels = [doc.metadata.get("chunk_level") for doc in docs[:3]]
        self.assertNotIn("macro", top_levels)
        self.assertIn("micro", top_levels)
        self.assertTrue(any("Rate Card" in doc.page_content for doc in docs))

    def test_markdown_table_annotation_preserves_true_header_and_page_marker_contract(self) -> None:
        markdown = "Before\n\n| Position | Number of Staff | Man hours |\n| --- | --- | --- |\n| Supervisor | 1 | 8 |\n\nAfter"
        annotated = _annotate_markdown_tables(markdown)
        self.assertIn("<!--TABLE:START id=t1 rows=1 cols=3-->", annotated)
        self.assertIn("| Position | Number of Staff | Man hours |", annotated)
        self.assertNotRegex(annotated, r"---\s*Page\s+\d+\s*---")

    def test_malformed_table_passes_through_byte_identical(self) -> None:
        malformed = "| Position | Staff |\n| Supervisor | 1 |\nordinary prose"
        self.assertEqual(_annotate_markdown_tables(malformed), malformed)

    def test_table_split_repeats_header_and_conserves_rows(self) -> None:
        body = "| Position | Staff |\n| --- | --- |\n" + "\n".join(
            f"| Role {index} | {index} |" for index in range(10)
        )
        parts = _split_table(body, max_tokens=25)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(part.splitlines()[:2] == body.splitlines()[:2] for part in parts))
        rows = [line for part in parts for line in part.splitlines()[2:] if line.strip()]
        self.assertEqual(rows, body.splitlines()[2:])

    def test_table_split_degrades_for_an_oversized_row(self) -> None:
        body = "| Label | Value |\n| --- | --- |\n| Role | " + ("x" * 2000) + " |"
        parts = _split_table(body, max_tokens=32)
        self.assertTrue(parts)
        self.assertTrue(any("Label:" in part for part in parts))

    def test_parse_quality_distinguishes_clean_markdown_from_replacement_soup(self) -> None:
        clean_score, _clean_signals = _score_parse_quality("# Heading\n\nA valid contractual paragraph with several words.", 1)
        soup_score, _soup_signals = _score_parse_quality("�" * 500, 1)
        self.assertGreater(clean_score, soup_score)

    def test_inline_references_and_addresses_do_not_become_tiny_meso_chunks(self) -> None:
        noisy_contract = """--- Page 1 ---
Exhibit 10.15

Section 7 below. The Committee shall determine the date of any Termination.

121 SW Salmon St

16. Miscellaneous
This Agreement may be amended only by a written instrument signed by both parties.
"""
        _clean_text, segments = self.segmenter.segment_text_with_page_markers(noisy_contract)
        meso_segments = [segment for segment in segments if segment.chunk_level == "meso"]
        section_paths = " ".join(segment.section_path or "" for segment in meso_segments)

        self.assertNotIn("Section 7 below", section_paths)
        self.assertNotIn("121 SW Salmon St", section_paths)


if __name__ == "__main__":
    unittest.main()
