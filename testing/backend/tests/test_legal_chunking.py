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
