"""Evaluate contract chunking and retrieval quality without mutating the database.

This script runs the current legal-aware chunker against indexed contract text,
then scores deterministic retrieval checks. DeepEval can be enabled optionally
when the package is installed; the default path stays cheap and reproducible.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List

from pymongo import DESCENDING, MongoClient

APP_BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "backend"
sys.path.insert(0, str(APP_BACKEND_ROOT))

from core.config import settings
from services.contract_agent.rag import ContractRAGSystem, DocumentSegmenter, EvidenceRetrievalService


LOGGER = logging.getLogger("contract_rag_eval")

GOLDEN_QUERIES = [
    {
        "name": "payment_terms",
        "query": "What are the payment terms, fees, rates, invoices, compensation, or award payment obligations?",
        "terms": ["payment", "pay", "paid", "invoice", "fee", "fees", "rate", "price", "compensation", "award", "cash"],
        "preferred_levels": {"micro", "meso"},
    },
    {
        "name": "deadline_notice",
        "query": "What deadlines, notice periods, cure periods, delivery windows, due dates, or termination timing apply?",
        "terms": ["within", "days", "notice", "deadline", "due", "termination", "cure", "no later", "hours", "minutes"],
        "preferred_levels": {"micro", "meso"},
    },
    {
        "name": "referenced_documents",
        "query": "Does the contract reference a rate card, schedule, exhibit, appendix, SLA, SOW, or attached pricing document?",
        "terms": ["rate card", "ratecard", "schedule", "exhibit", "appendix", "annex", "sla", "statement of work", "sow", "pricing"],
        "preferred_levels": {"micro", "meso"},
    },
    {
        "name": "summary_coverage",
        "query": "Give a summary overview of this contract and its major sections.",
        "terms": ["agreement", "article", "section", "parties", "definitions", "term"],
        "preferred_levels": {"macro", "meso"},
    },
]


def count_tokens(text: str) -> int:
    try:
        import tiktoken

        encoder = tiktoken.get_encoding("cl100k_base")
        return len(encoder.encode(text or ""))
    except Exception:
        return max(1, int(len((text or "").split()) * 1.3))


def percentile(values: List[int], ratio: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = int(round((len(ordered) - 1) * ratio))
    return ordered[index]


def expected_score(text: str, terms: Iterable[str]) -> int:
    lowered = (text or "").lower()
    return sum(1 for term in terms if term in lowered)


def matched_terms(text: str, terms: Iterable[str]) -> set[str]:
    lowered = (text or "").lower()
    return {term for term in terms if term in lowered}


def score_retrieval_metrics(
    *,
    all_segments: List[Any],
    retrieved_docs: List[Any],
    terms: Iterable[str],
    preferred_levels: set[str],
) -> Dict[str, Any]:
    terms = list(terms)
    all_source_text = "\n".join(segment.text for segment in all_segments)
    available_terms = matched_terms(all_source_text, terms)
    retrieved_terms = matched_terms("\n".join(doc.page_content for doc in retrieved_docs), terms)

    relevant_retrieved = 0
    first_relevant_rank = None
    exact_citeable = 0
    segment_by_id = {segment.id: segment for segment in all_segments}
    preferred_level_hit = False

    for rank, doc in enumerate(retrieved_docs, start=1):
        metadata = doc.metadata or {}
        chunk_level = metadata.get("chunk_level")
        preferred_level_hit = preferred_level_hit or chunk_level in preferred_levels
        doc_terms = matched_terms(doc.page_content, available_terms or terms)
        is_relevant = bool(doc_terms)
        if is_relevant:
            relevant_retrieved += 1
            if first_relevant_rank is None:
                first_relevant_rank = rank

        segment = segment_by_id.get(metadata.get("segment_id"))
        page_ready = metadata.get("page_start") is not None or metadata.get("page_number") is not None
        if segment and page_ready:
            segment_text = segment.text or ""
            doc_text = doc.page_content or ""
            if doc_text in segment_text or segment_text in doc_text:
                exact_citeable += 1

    retrieved_count = len(retrieved_docs)
    context_precision = relevant_retrieved / retrieved_count if retrieved_count else 0.0
    term_recall = len(retrieved_terms) / len(available_terms) if available_terms else 1.0
    mrr = (1 / first_relevant_rank) if first_relevant_rank else 0.0
    faithfulness_proxy = exact_citeable / retrieved_count if retrieved_count else 0.0
    retrieval_accuracy = 1.0 if context_precision > 0 and term_recall > 0 and preferred_level_hit else 0.0

    return {
        "context_precision_at_k": round(context_precision, 3),
        "term_recall_at_k": round(term_recall, 3),
        "mrr": round(mrr, 3),
        "retrieval_accuracy": round(retrieval_accuracy, 3),
        "faithfulness_proxy": round(faithfulness_proxy, 3),
        "available_terms": sorted(available_terms),
        "retrieved_terms": sorted(retrieved_terms),
        "relevant_retrieved": relevant_retrieved,
        "retrieved_count": retrieved_count,
        "preferred_level_hit": preferred_level_hit,
    }


def score_graph_tool_metrics(
    *,
    search_hits: List[Dict[str, Any]],
    read_hits: List[Dict[str, Any]],
    terms: Iterable[str],
) -> Dict[str, Any]:
    terms = list(terms)
    hit_count = len(search_hits)
    quote_hits = [
        hit for hit in search_hits
        if matched_terms(str(hit.get("quote") or hit.get("snippet") or ""), terms)
    ]
    compact_quote_hits = [
        hit for hit in quote_hits
        if 0 < len(str(hit.get("quote") or "")) <= 700
    ]
    page_ready_hits = [
        hit for hit in search_hits
        if hit.get("page_start") is not None or hit.get("page") is not None
    ]
    requested_ids = {
        str(hit.get("evidence_id") or hit.get("segment_id") or "")
        for hit in search_hits[:3]
        if hit.get("evidence_id") or hit.get("segment_id")
    }
    read_ids = {
        str(hit.get("evidence_id") or hit.get("segment_id") or "")
        for hit in read_hits
        if hit.get("evidence_id") or hit.get("segment_id")
    }
    read_after_search_compliance = 1.0 if not requested_ids or requested_ids <= read_ids else 0.0
    return {
        "citation_quote_precision": round(len(quote_hits) / hit_count, 3) if hit_count else 0.0,
        "exact_span_precision_proxy": round(len(compact_quote_hits) / hit_count, 3) if hit_count else 0.0,
        "page_ready_rate": round(len(page_ready_hits) / hit_count, 3) if hit_count else 0.0,
        "read_after_search_compliance": read_after_search_compliance,
        "searched_count": hit_count,
        "read_count": len(read_hits),
    }


def rag_without_init(segmenter: DocumentSegmenter) -> ContractRAGSystem:
    rag = object.__new__(ContractRAGSystem)
    rag.logger = LOGGER
    rag.segmenter = segmenter
    return rag


def load_contracts(limit: int) -> List[Dict[str, Any]]:
    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=8000)
    client.admin.command("ping")
    collection = client["contract_analysis_db"]["contracts"]
    return list(
        collection.find(
            {"index.content": {"$type": "string", "$ne": ""}},
            {
                "contract_name": 1,
                "projectId": 1,
                "index.content": 1,
                "index.vector_namespace": 1,
                "index.embedded_at": 1,
            },
        )
        .sort([("index.embedded_at", DESCENDING)])
        .limit(limit)
    )


def evaluate_contract(contract: Dict[str, Any], segmenter: DocumentSegmenter, rag: ContractRAGSystem) -> Dict[str, Any]:
    contract_id = str(contract["_id"])
    contract_name = contract.get("contract_name") or contract_id
    index_data = contract.get("index") or {}
    clean_text, segments = segmenter.segment_text_with_page_markers(index_data.get("content") or "")
    prepared_segments = rag._prepare_segments_for_document(
        segments,
        contract_id=contract_id,
        contract_name=contract_name,
    )

    token_counts = [count_tokens(segment.text) for segment in prepared_segments]
    level_counts = Counter(segment.chunk_level for segment in prepared_segments)
    value_type_counts = Counter(value_type for segment in prepared_segments for value_type in (segment.value_types or []))
    tiny_meso = [
        segment
        for segment in prepared_segments
        if segment.chunk_level == "meso" and count_tokens(segment.text) < 40
    ]
    metadata_ok = all(
        segment.section_path
        and segment.page_start is not None
        and segment.char_start is not None
        and segment.char_end is not None
        for segment in prepared_segments
    )

    retrieval_results = []
    evidence_service = EvidenceRetrievalService(segmenter=segmenter)
    for query_info in GOLDEN_QUERIES:
        docs = rag._keyword_segment_documents(
            prepared_segments,
            query_info["query"],
            top_k=6,
        )
        top_docs = docs[:3]
        top_text = "\n".join(doc.page_content for doc in top_docs)
        hit_score = expected_score(top_text, query_info["terms"])
        preferred_hit = any(
            (doc.metadata or {}).get("chunk_level") in query_info["preferred_levels"]
            for doc in top_docs
        )
        metrics = score_retrieval_metrics(
            all_segments=prepared_segments,
            retrieved_docs=docs,
            terms=query_info["terms"],
            preferred_levels=query_info["preferred_levels"],
        )
        search_hits = evidence_service.search_segments(
            prepared_segments,
            query_info["query"],
            limit=6,
        )
        read_hits = evidence_service.read_segments(
            prepared_segments,
            [
                str(hit.get("evidence_id") or hit.get("segment_id"))
                for hit in search_hits[:3]
                if hit.get("evidence_id") or hit.get("segment_id")
            ],
        )
        graph_tool_metrics = score_graph_tool_metrics(
            search_hits=search_hits,
            read_hits=read_hits,
            terms=query_info["terms"],
        )
        retrieval_results.append(
            {
                "query": query_info["name"],
                "pass": bool(hit_score > 0 and preferred_hit),
                "hit_score": hit_score,
                "metrics": metrics,
                "graph_tool_metrics": graph_tool_metrics,
                "top_levels": [(doc.metadata or {}).get("chunk_level") for doc in top_docs],
                "top_sections": [(doc.metadata or {}).get("section_path") for doc in top_docs],
                "top_pages": [
                    [(doc.metadata or {}).get("page_start"), (doc.metadata or {}).get("page_end")]
                    for doc in top_docs
                ],
                "retrieval_context": [doc.page_content for doc in docs],
                "tool_quotes": [hit.get("quote") for hit in search_hits[:3]],
            }
        )

    return {
        "contract_id": contract_id,
        "contract": contract_name,
        "clean_text_tokens": count_tokens(clean_text),
        "chunk_count": len(prepared_segments),
        "chunk_tokens_total": sum(token_counts),
        "avg_chunk_tokens": round(sum(token_counts) / max(len(token_counts), 1), 1),
        "p90_chunk_tokens": percentile(token_counts, 0.9),
        "max_chunk_tokens": max(token_counts) if token_counts else 0,
        "level_counts": dict(level_counts),
        "value_type_counts": dict(value_type_counts),
        "metadata_ok": metadata_ok,
        "tiny_meso_count": len(tiny_meso),
        "tiny_meso_examples": [segment.section_path for segment in tiny_meso[:5]],
        "retrieval_results": retrieval_results,
    }


def evaluate_project_coverage(
    contracts: List[Dict[str, Any]],
    segmenter: DocumentSegmenter,
    rag: ContractRAGSystem,
) -> Dict[str, Any] | None:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for contract in contracts:
        project_id = contract.get("projectId")
        if project_id:
            grouped[str(project_id)].append(contract)
    if not grouped:
        return None

    project_id, docs_for_project = max(grouped.items(), key=lambda item: len(item[1]))
    all_segments = []
    for contract in docs_for_project:
        contract_id = str(contract["_id"])
        contract_name = contract.get("contract_name") or contract_id
        clean_text, segments = segmenter.segment_text_with_page_markers((contract.get("index") or {}).get("content") or "")
        if clean_text.strip():
            all_segments.extend(
                rag._prepare_segments_for_document(
                    segments,
                    contract_id=contract_id,
                    contract_name=contract_name,
                )
            )

    representative_docs = rag._representative_project_context_docs(
        all_segments,
        "compare payment terms across all contracts and rate cards",
        max_segments=18,
    )
    retrieved = rag._hybrid_retrieve_documents(
        question="compare payment terms across all contracts and rate cards",
        segments=all_segments,
        vector_store=None,
        search_kwargs=None,
        coverage_docs=representative_docs,
        coverage_first=True,
        max_docs=18,
    )
    return {
        "project_id": project_id,
        "documents_in_sample": len(docs_for_project),
        "all_segments": len(all_segments),
        "retrieved_docs": len(retrieved),
        "distinct_contracts_retrieved": len({(doc.metadata or {}).get("contract_id") for doc in retrieved}),
        "top_levels": [(doc.metadata or {}).get("chunk_level") for doc in retrieved[:8]],
        "top_documents": [(doc.metadata or {}).get("contract_name") for doc in retrieved[:8]],
    }


def maybe_run_deepeval(report: Dict[str, Any], model: str | None) -> Dict[str, Any]:
    try:
        from deepeval import evaluate
        from deepeval.metrics import ContextualRelevancyMetric
        from deepeval.test_case import LLMTestCase
    except ImportError:
        return {
            "enabled": False,
            "reason": "deepeval is not installed. Install it in the backend environment to run LLM-judge evals.",
        }

    test_cases = []
    for contract in report["contracts"]:
        for retrieval_result in contract["retrieval_results"]:
            test_cases.append(
                LLMTestCase(
                    input=retrieval_result["query"],
                    retrieval_context=retrieval_result["retrieval_context"],
                )
            )

    metric_kwargs: Dict[str, Any] = {"threshold": 0.6}
    if model:
        metric_kwargs["model"] = model
    contextual_relevancy = ContextualRelevancyMetric(**metric_kwargs)
    result = evaluate(test_cases=test_cases, metrics=[contextual_relevancy])
    return {
        "enabled": True,
        "metric": "ContextualRelevancyMetric",
        "test_cases": len(test_cases),
        "result": str(result),
    }


def build_report(limit: int) -> Dict[str, Any]:
    contracts = load_contracts(limit)
    segmenter = DocumentSegmenter()
    rag = rag_without_init(segmenter)
    contract_reports = [evaluate_contract(contract, segmenter, rag) for contract in contracts]

    overall = {
        "contracts_evaluated": len(contract_reports),
        "chunks": sum(row["chunk_count"] for row in contract_reports),
        "tokens": sum(row["chunk_tokens_total"] for row in contract_reports),
        "tiny_meso": sum(row["tiny_meso_count"] for row in contract_reports),
        "metadata_failures": sum(1 for row in contract_reports if not row["metadata_ok"]),
        "retrieval_checks": sum(len(row["retrieval_results"]) for row in contract_reports),
        "retrieval_passes": sum(
            1
            for row in contract_reports
            for retrieval_result in row["retrieval_results"]
            if retrieval_result["pass"]
        ),
    }
    metric_rows = [
        retrieval_result["metrics"]
        for row in contract_reports
        for retrieval_result in row["retrieval_results"]
        if retrieval_result.get("metrics")
    ]
    graph_tool_metric_rows = [
        retrieval_result["graph_tool_metrics"]
        for row in contract_reports
        for retrieval_result in row["retrieval_results"]
        if retrieval_result.get("graph_tool_metrics")
    ]
    overall["retrieval_pass_rate"] = round(overall["retrieval_passes"] / max(overall["retrieval_checks"], 1), 3)
    overall["avg_chunk_tokens"] = round(overall["tokens"] / max(overall["chunks"], 1), 1)
    overall["tiny_meso_rate"] = round(overall["tiny_meso"] / max(overall["chunks"], 1), 3)
    overall["context_precision_at_6"] = round(
        sum(row["context_precision_at_k"] for row in metric_rows) / max(len(metric_rows), 1),
        3,
    )
    overall["term_recall_at_6"] = round(
        sum(row["term_recall_at_k"] for row in metric_rows) / max(len(metric_rows), 1),
        3,
    )
    overall["mrr"] = round(sum(row["mrr"] for row in metric_rows) / max(len(metric_rows), 1), 3)
    overall["retrieval_accuracy"] = round(
        sum(row["retrieval_accuracy"] for row in metric_rows) / max(len(metric_rows), 1),
        3,
    )
    overall["faithfulness_proxy"] = round(
        sum(row["faithfulness_proxy"] for row in metric_rows) / max(len(metric_rows), 1),
        3,
    )
    overall["citation_quote_precision"] = round(
        sum(row["citation_quote_precision"] for row in graph_tool_metric_rows) / max(len(graph_tool_metric_rows), 1),
        3,
    )
    overall["exact_span_precision_proxy"] = round(
        sum(row["exact_span_precision_proxy"] for row in graph_tool_metric_rows) / max(len(graph_tool_metric_rows), 1),
        3,
    )
    overall["page_ready_rate"] = round(
        sum(row["page_ready_rate"] for row in graph_tool_metric_rows) / max(len(graph_tool_metric_rows), 1),
        3,
    )
    overall["read_after_search_compliance"] = round(
        sum(row["read_after_search_compliance"] for row in graph_tool_metric_rows) / max(len(graph_tool_metric_rows), 1),
        3,
    )

    return {
        "overall": overall,
        "contracts": contract_reports,
        "project_eval": evaluate_project_coverage(contracts, segmenter, rag),
    }


def compact_report(report: Dict[str, Any]) -> Dict[str, Any]:
    compact_contracts = []
    for contract in report["contracts"]:
        compact_contracts.append(
            {
                key: value
                for key, value in contract.items()
                if key not in {"retrieval_results"}
            }
            | {
                "retrieval_results": [
                    {key: value for key, value in item.items() if key != "retrieval_context"}
                    for item in contract["retrieval_results"]
                ]
            }
        )
    return {
        "overall": report["overall"],
        "contracts": compact_contracts,
        "project_eval": report["project_eval"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate contract RAG chunking and retrieval quality.")
    parser.add_argument("--limit", type=int, default=6, help="Number of recent indexed contracts to evaluate.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a compact text summary.")
    parser.add_argument("--deep-eval", action="store_true", help="Also run DeepEval contextual relevancy if installed.")
    parser.add_argument("--deepeval-model", default=None, help="Optional DeepEval judge model name.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    report = build_report(limit=args.limit)
    if args.deep_eval:
        report["deepeval"] = maybe_run_deepeval(report, args.deepeval_model)

    output = compact_report(report)
    if args.json:
        print(json.dumps(output, indent=2, default=str))
        return

    overall = output["overall"]
    print("Contract RAG Evaluation")
    print(f"- contracts: {overall['contracts_evaluated']}")
    print(f"- chunks: {overall['chunks']}")
    print(f"- total chunk tokens: {overall['tokens']}")
    print(f"- avg chunk tokens: {overall['avg_chunk_tokens']}")
    print(f"- retrieval pass rate: {overall['retrieval_pass_rate']}")
    print(f"- context precision@6: {overall['context_precision_at_6']}")
    print(f"- term recall@6: {overall['term_recall_at_6']}")
    print(f"- MRR: {overall['mrr']}")
    print(f"- retrieval accuracy: {overall['retrieval_accuracy']}")
    print(f"- faithfulness proxy: {overall['faithfulness_proxy']}")
    print(f"- citation quote precision: {overall['citation_quote_precision']}")
    print(f"- exact span precision proxy: {overall['exact_span_precision_proxy']}")
    print(f"- page ready rate: {overall['page_ready_rate']}")
    print(f"- read-after-search compliance: {overall['read_after_search_compliance']}")
    print(f"- metadata failures: {overall['metadata_failures']}")
    print(f"- tiny meso chunks: {overall['tiny_meso']} ({overall['tiny_meso_rate']})")
    if output.get("project_eval"):
        project_eval = output["project_eval"]
        print(
            "- project coverage: "
            f"{project_eval['distinct_contracts_retrieved']}/{project_eval['documents_in_sample']} docs retrieved"
        )
    if output.get("deepeval"):
        print(f"- deepeval: {output['deepeval']}")


if __name__ == "__main__":
    main()
