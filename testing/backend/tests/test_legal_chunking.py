import logging
import os
import sys
import unittest
from types import SimpleNamespace
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

from services.contract_agent.rag import ContractRAGSystem, DocumentSegmenter
from services.contract_agent.rag.vector_store import _batched, _linearize_table_for_embedding, segments_to_index_documents
from services.contract_agent.rag.schemas import TextSegment
from worker.tasks import _annotate_markdown_tables, _process_with_liteparse, _score_parse_quality, _table_statistics


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
        rag._vector_manager = SimpleNamespace(segmenter=self.segmenter)
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

    def test_ocr_retry_failure_keeps_usable_native_markdown(self) -> None:
        native_pages = [(1, "Native parse remains usable with contractual content." )]

        def parse_side_effect(_path, *, ocr_enabled):
            if ocr_enabled:
                raise RuntimeError("OCR service unavailable")
            return native_pages, native_pages[0][1]

        with patch("worker.tasks._liteparse_markdown_pages", side_effect=parse_side_effect), patch.object(
            __import__("worker.tasks", fromlist=["settings"]).settings,
            "parse_quality_min",
            1.1,
        ):
            result = _process_with_liteparse(Path("/tmp/native.pdf"), "native.pdf", "contract-1")

        self.assertTrue(result["success"])
        self.assertIn("Native parse remains usable", result["markdown"])

    def test_one_logical_table_chunk_preserves_duplicate_rows_and_stable_identity(self) -> None:
        duplicate_row = "| Duplicate fee | " + ("repeated value " * 450) + "|"
        body = "| Label | Value |\n| --- | --- |\n" + "\n".join([duplicate_row] * 46)
        table_segments = self.segmenter._table_segments_for_section(
            full_text=body,
            section={"start": 0, "end": len(body), "path": "Document", "tags": []},
            page_spans=[(1, 0, len(body))],
            table_spans=[(0, len(body), {"rows": 46, "cols": 2, "table_id": "table_1_duplicate"})],
        )
        self.assertEqual(len(table_segments), 1)
        table_segment = table_segments[0]
        self.assertEqual(table_segment.table_id, "table_1_duplicate")
        self.assertIsNone(table_segment.table_part_index)
        self.assertIsNone(table_segment.table_part_count)
        self.assertEqual(table_segment.text.count(duplicate_row), 46)
        self.assertFalse(table_segment.embedding_eligible)
        self.assertEqual(table_segment.embedding_skip_reason, "table exceeds embedding token limit")

    def test_contract_table_statistics_count_source_tables_not_chunks(self) -> None:
        markdown = (
            "--- Page 1 ---\n\n"
            "<!--TABLE:START id=t1 rows=2 cols=2-->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n<!--TABLE:END id=t1-->\n\n"
            "--- Page 2 ---\n\n"
            "<!--TABLE:START id=t1 rows=1 cols=3-->\n| X | Y | Z |\n| --- | --- | --- |\n| a | b | c |\n<!--TABLE:END id=t1-->"
        )
        stats = _table_statistics(markdown)
        self.assertEqual(stats["table_count"], 2)
        self.assertEqual(stats["table_row_count"], 3)
        self.assertEqual([detail["page"] for detail in stats["tables"]], [1, 2])
        self.assertNotEqual(stats["tables"][0]["table_id"], stats["tables"][1]["table_id"])

    def test_table_embedding_is_linearized_but_display_text_stays_markdown(self) -> None:
        markdown_table = "| Position | Staff |\n| --- | --- |\n| Supervisor | 1 |"
        segment = TextSegment(
            id="table-1",
            text=markdown_table,
            type="table",
            start_index=0,
            end_index=len(markdown_table),
            chunk_schema_version=3,
            chunk_level="table",
        )
        document = segments_to_index_documents(
            [segment],
            contract_name="sample",
            contract_id="contract-1",
        )[0]
        self.assertIn("Position: Supervisor", document.page_content)
        self.assertNotIn("| Supervisor | 1 |", document.page_content)
        self.assertEqual(document.metadata["display_text"], markdown_table)

        oversized = segment.model_copy(update={"embedding_eligible": False, "embedding_skip_reason": "table exceeds embedding token limit"})
        self.assertEqual(
            segments_to_index_documents([oversized], contract_name="sample", contract_id="contract-1"),
            [],
        )

    def test_vector_writes_are_bounded_batches(self) -> None:
        self.assertEqual(_batched(list(range(5)), n=2), [[0, 1], [2, 3], [4]])

    def test_parse_quality_distinguishes_clean_markdown_from_replacement_soup(self) -> None:
        clean_score, _clean_signals = _score_parse_quality("# Heading\n\nA valid contractual paragraph with several words.", 1)
        soup_score, _soup_signals = _score_parse_quality("�" * 500, 1)
        self.assertGreater(clean_score, soup_score)

    def test_markdown_fixture_coverage_has_no_large_gaps(self) -> None:
        dataset_dir = Path(__file__).resolve().parents[3] / "final_evaluation" / "datasets" / "kpi_contracts"
        for markdown_path in sorted(dataset_dir.glob("*.md")):
            raw_markdown = markdown_path.read_text(encoding="utf-8")
            if not raw_markdown.strip():
                continue
            full_text, segments = self.segmenter.segment_text_with_page_markers(raw_markdown)
            intervals = sorted(
                (segment.char_start, segment.char_end)
                for segment in segments
                if segment.type in {"meso", "table"}
                and segment.char_start is not None
                and segment.char_end is not None
                and segment.char_end > segment.char_start
            )
            merged = []
            for start, end in intervals:
                if merged and start <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(merged[-1][1], end))
                else:
                    merged.append((start, end))
            cursor = 0
            gaps = []
            covered_chars = 0
            for start, end in merged:
                if start > cursor:
                    gaps.append((cursor, start))
                covered_chars += max(0, end - max(cursor, start))
                cursor = max(cursor, end)
            if cursor < len(full_text):
                gaps.append((cursor, len(full_text)))
            large_gaps = [gap for gap in gaps if gap[1] - gap[0] > 40]
            coverage = covered_chars / max(1, len(full_text))
            self.assertGreaterEqual(coverage, 0.99, markdown_path.name)
            self.assertFalse(large_gaps, f"{markdown_path.name}: {large_gaps}")

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
