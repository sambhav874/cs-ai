#!/usr/bin/env python3
"""Prepare an ACORD manifest for the final ContractSense evaluation.

ACORD is BEIR-style: corpus.jsonl, queries.jsonl, and qrels/*.tsv. This
script turns selected attorney queries into clause-bank PDFs so ContractSense is
still evaluated through upload, indexing, and end-agent product APIs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from final_evaluation.scripts.github_fetch import fetch_acord_from_github
from final_evaluation.scripts.prepare_cuad import write_text_pdf


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare ACORD manifest for ContractSense final evaluation.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--acord-root", type=Path, help="Extracted ACORD folder containing corpus.jsonl, queries.jsonl, qrels.")
    source.add_argument("--acord-zip", type=Path, help="Downloaded ACORD zip from Atticus/Hugging Face.")
    source.add_argument("--fetch-github", action="store_true", help="Download TheAtticusProject/acord zip from GitHub.")
    parser.add_argument("--download-dir", type=Path, default=Path("final_evaluation/datasets/raw"))
    parser.add_argument("--force-download", action="store_true", help="Redownload and re-extract the GitHub zip.")
    parser.add_argument("--output", type=Path, default=Path("final_evaluation/datasets/acord_manifest.jsonl"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("final_evaluation/datasets/generated_acord_pdfs"))
    parser.add_argument("--contract-count", type=int, default=10, choices=[10, 25, 50, 100])
    parser.add_argument("--seed", type=int, default=874)
    parser.add_argument("--split", default="test", choices=["train", "valid", "dev", "test", "all"])
    parser.add_argument("--min-relevance-score", type=int, default=3, help="BEIR qrels score treated as relevant. ACORD scores 0-4.")
    parser.add_argument("--gold-clauses-per-query", type=int, default=3)
    parser.add_argument("--max-clauses-per-query", type=int, default=80)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    fetched_root = fetch_acord_from_github(args.download_dir, force=args.force_download) if args.fetch_github else None
    if fetched_root:
        print(f"Fetched ACORD from GitHub: {fetched_root}")
    with maybe_extract_zip(args.acord_zip) as root:
        acord_root = args.acord_root or fetched_root or root
        if not acord_root:
            raise SystemExit("Missing ACORD source.")
        corpus, queries, qrels = load_acord(acord_root, args.split)
        records = build_records(
            corpus=corpus,
            queries=queries,
            qrels=qrels,
            source_root=acord_root,
            count=args.contract_count,
            seed=args.seed,
            min_relevance_score=args.min_relevance_score,
            gold_clauses_per_query=args.gold_clauses_per_query,
            max_clauses_per_query=args.max_clauses_per_query,
            artifacts_dir=args.artifacts_dir,
            split=args.split,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"Wrote {len(records)} ACORD query clause-bank records to {args.output}")
    return 0


class maybe_extract_zip:
    def __init__(self, zip_path: Optional[Path]) -> None:
        self.zip_path = zip_path
        self.tempdir: Optional[tempfile.TemporaryDirectory[str]] = None

    def __enter__(self) -> Optional[Path]:
        if not self.zip_path:
            return None
        self.tempdir = tempfile.TemporaryDirectory(prefix="acord_extract_")
        with zipfile.ZipFile(self.zip_path) as archive:
            archive.extractall(self.tempdir.name)
        return Path(self.tempdir.name)

    def __exit__(self, *_exc: object) -> None:
        if self.tempdir:
            self.tempdir.cleanup()


def load_acord(root: Path, split: str) -> Tuple[Dict[str, Dict[str, str]], Dict[str, str], Dict[str, Dict[str, int]]]:
    corpus_path = find_one(root, "corpus.jsonl")
    queries_path = find_one(root, "queries.jsonl")
    if not corpus_path or not queries_path:
        raise FileNotFoundError("Could not find corpus.jsonl and queries.jsonl in ACORD source.")
    corpus = load_corpus(corpus_path)
    queries = load_queries(queries_path)
    qrels = load_qrels(root, split)
    if not qrels:
        raise ValueError(f"No qrels found for split {split}.")
    return corpus, queries, qrels


def find_one(root: Path, name: str) -> Optional[Path]:
    matches = sorted(path for path in root.rglob(name) if path.is_file())
    return matches[0] if matches else None


def load_corpus(path: Path) -> Dict[str, Dict[str, str]]:
    rows: Dict[str, Dict[str, str]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            doc_id = str(item.get("_id") or item.get("id") or item.get("doc_id") or "").strip()
            if not doc_id:
                continue
            rows[doc_id] = {
                "title": str(item.get("title") or ""),
                "text": str(item.get("text") or item.get("contents") or ""),
            }
    return rows


def load_queries(path: Path) -> Dict[str, str]:
    rows: Dict[str, str] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            query_id = str(item.get("_id") or item.get("id") or item.get("query_id") or "").strip()
            text = str(item.get("text") or item.get("query") or "").strip()
            if query_id and text:
                rows[query_id] = text
    return rows


def load_qrels(root: Path, split: str) -> Dict[str, Dict[str, int]]:
    qrel_files = find_qrel_files(root, split)
    grouped: Dict[str, Dict[str, int]] = {}
    for path in qrel_files:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                parts = line.strip().split("\t")
                if len(parts) < 3 or parts[0].lower() in {"query-id", "query_id", "qid"}:
                    continue
                query_id, corpus_id, score_text = parts[0], parts[1], parts[2]
                try:
                    score = int(float(score_text))
                except ValueError:
                    continue
                grouped.setdefault(str(query_id), {})[str(corpus_id)] = score
    return grouped


def find_qrel_files(root: Path, split: str) -> List[Path]:
    candidates = sorted(path for path in root.rglob("*.tsv") if "qrels" in str(path).lower())
    if split == "all":
        return candidates
    names = {split}
    if split == "valid":
        names.add("dev")
    if split == "dev":
        names.add("valid")
    filtered = [path for path in candidates if path.stem.lower() in names]
    return filtered or candidates


def build_records(
    *,
    corpus: Dict[str, Dict[str, str]],
    queries: Dict[str, str],
    qrels: Dict[str, Dict[str, int]],
    source_root: Path,
    count: int,
    seed: int,
    min_relevance_score: int,
    gold_clauses_per_query: int,
    max_clauses_per_query: int,
    artifacts_dir: Path,
    split: str,
) -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    query_ids = [
        query_id
        for query_id, scores in qrels.items()
        if query_id in queries and any(score >= min_relevance_score for score in scores.values())
    ]
    query_ids.sort(key=lambda query_id: (category_from_query(queries[query_id]), query_id))
    rng.shuffle(query_ids)
    selected = stratified_query_sample(query_ids, queries, count, seed)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for query_id in selected:
        record = build_record_for_query(
            query_id=query_id,
            query=queries[query_id],
            scores=qrels[query_id],
            corpus=corpus,
            source_root=source_root,
            min_relevance_score=min_relevance_score,
            gold_clauses_per_query=gold_clauses_per_query,
            max_clauses_per_query=max_clauses_per_query,
            artifacts_dir=artifacts_dir,
            split=split,
            seed=seed,
            requested_count=count,
        )
        records.append(record)
    records.sort(key=lambda row: row["contract_id"])
    return records


def stratified_query_sample(query_ids: List[str], queries: Dict[str, str], count: int, seed: int) -> List[str]:
    rng = random.Random(seed)
    buckets: Dict[str, List[str]] = {}
    for query_id in query_ids:
        buckets.setdefault(category_from_query(queries[query_id]), []).append(query_id)
    for rows in buckets.values():
        rng.shuffle(rows)
    selected: List[str] = []
    keys = sorted(buckets)
    while len(selected) < count and keys:
        progressed = False
        for key in keys:
            rows = buckets[key]
            if rows:
                selected.append(rows.pop(0))
                progressed = True
                if len(selected) >= count:
                    break
        if not progressed:
            break
    return selected


def build_record_for_query(
    *,
    query_id: str,
    query: str,
    scores: Dict[str, int],
    corpus: Dict[str, Dict[str, str]],
    source_root: Path,
    min_relevance_score: int,
    gold_clauses_per_query: int,
    max_clauses_per_query: int,
    artifacts_dir: Path,
    split: str,
    seed: int,
    requested_count: int,
) -> Dict[str, Any]:
    ranked = sorted(
        ((doc_id, score) for doc_id, score in scores.items() if doc_id in corpus and corpus[doc_id]["text"].strip()),
        key=lambda item: (-item[1], stable_hash(query_id, item[0])),
    )
    gold = [item for item in ranked if item[1] >= min_relevance_score][:gold_clauses_per_query]
    distractors = [item for item in ranked if item not in gold]
    candidates = (gold + distractors)[:max_clauses_per_query]
    category = category_from_query(query)
    title = f"ACORD Clause Bank - {category.title()} - {query_id}"
    text, spans_by_doc = render_clause_bank_text(query_id, query, candidates, corpus)
    labels = []
    for doc_id, score in gold:
        span = spans_by_doc.get(doc_id)
        if not span:
            continue
        labels.append(
            {
                "clause_type": f"acord relevant precedent clause ({score + 1}-star)",
                "question": query,
                "present": True,
                "rating": score + 1,
                "beir_score": score,
                "corpus_id": doc_id,
                "spans": [span],
            }
        )
    negative_spans = [
        {**spans_by_doc[doc_id], "rating": score + 1, "beir_score": score, "corpus_id": doc_id}
        for doc_id, score in candidates
        if score < min_relevance_score and doc_id in spans_by_doc
    ][:10]
    contract_id = stable_record_id(query_id, query)
    pdf_path = artifacts_dir / f"{contract_id}.pdf"
    write_text_pdf(pdf_path, title, text)
    stats = {
        "char_count": len(text),
        "annotation_count": len(labels),
        "clause_type_count": 1,
        "candidate_clause_count": len(candidates),
        "gold_clause_count": len(labels),
    }
    return {
        "contract_id": contract_id,
        "dataset": "ACORD",
        "title": title,
        "text": text,
        "labels": labels,
        "absent_clause_types": ["unrated precedent clause", "low-rated off-topic clause"],
        "source_pdf_path": str(pdf_path),
        "transport": "rendered_clause_bank_pdf",
        "stats": stats,
        "source": {
            "dataset": "ACORD",
            "license": "CC BY 4.0",
            "source_root": str(source_root),
        },
        "acord": {
            "query_id": query_id,
            "query": query,
            "split": split,
            "category": category,
            "min_relevance_score": min_relevance_score,
            "gold_clauses_per_query": gold_clauses_per_query,
            "max_clauses_per_query": max_clauses_per_query,
            "relevant_corpus_ids": [doc_id for doc_id, _score in gold],
            "candidate_corpus_ids": [doc_id for doc_id, _score in candidates],
            "negative_spans": negative_spans,
        },
        "sampling": {
            **sampling_features(stats, category),
            "seed": seed,
            "requested_contract_count": requested_count,
        },
        "split": "evaluation",
    }


def render_clause_bank_text(
    query_id: str,
    query: str,
    candidates: Iterable[Tuple[str, int]],
    corpus: Dict[str, Dict[str, str]],
) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    parts = [
        f"ACORD Query ID: {query_id}",
        f"Attorney drafting query: {query}",
        "Instruction: candidate clauses below are precedent candidates. Select only the most relevant clauses.",
        "",
    ]
    spans: Dict[str, Dict[str, Any]] = {}
    offset = sum(len(part) + 1 for part in parts)
    for index, (doc_id, score) in enumerate(candidates, start=1):
        row = corpus[doc_id]
        header = f"Candidate Clause {index:03d} | corpus_id={doc_id} | attorney_rating={score + 1} stars"
        title = row.get("title") or "Untitled clause"
        clause = clean_clause_text(row.get("text") or "")
        block = f"{header}\nSource title: {title}\n{clause}\n"
        clause_start = offset + len(header) + 1 + len("Source title: ") + len(title) + 1
        clause_end = clause_start + len(clause)
        spans[doc_id] = {"text": clause, "start": clause_start, "end": clause_end}
        parts.append(block)
        offset += len(block) + 1
    return "\n".join(parts).strip(), spans


def clean_clause_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def stable_record_id(query_id: str, query: str) -> str:
    digest = hashlib.sha1(f"{query_id}:{query}".encode("utf-8")).hexdigest()[:12]
    slug = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")[:70] or "query"
    return f"acord-{query_id}-{slug}-{digest}"


def stable_hash(*parts: str) -> str:
    return hashlib.sha1(":".join(parts).encode("utf-8")).hexdigest()


def category_from_query(query: str) -> str:
    lowered = query.lower()
    categories = {
        "limitation_of_liability": ("liability", "damages cap", "consequential damages"),
        "indemnification": ("indemn", "defend", "hold harmless"),
        "change_of_control": ("change of control", "assignment", "merger"),
        "most_favored_nation": ("most favored", "mfn"),
        "restrictive_covenants": ("non-compete", "non-solicit", "exclusiv", "restrictive"),
        "term": ("term", "renew", "expiration", "terminate"),
        "governing_law": ("governing law", "jurisdiction", "venue"),
        "liquidated_damages": ("liquidated damages",),
        "ip_ownership_license": ("intellectual property", "ip ownership", "license"),
        "third_party_beneficiary": ("third party beneficiary", "third-party beneficiary"),
        "affirmative_covenants": ("shall", "must", "covenant", "obligation"),
    }
    for category, needles in categories.items():
        if any(needle in lowered for needle in needles):
            return category
    return "general"


def sampling_features(stats: Dict[str, int], category: str) -> Dict[str, Any]:
    chars = int(stats.get("char_count") or 0)
    candidates = int(stats.get("candidate_clause_count") or 0)
    if chars < 35_000:
        length_bucket = "short"
    elif chars < 90_000:
        length_bucket = "medium"
    else:
        length_bucket = "long"
    if candidates < 25:
        density_bucket = "sparse"
    elif candidates < 60:
        density_bucket = "normal"
    else:
        density_bucket = "dense"
    return {
        "length_bucket": length_bucket,
        "density_bucket": density_bucket,
        "diversity_bucket": category,
        "density_per_10k_chars": round(candidates / max(chars / 10_000, 1), 3),
        "agreement_type": "clause_retrieval",
    }


if __name__ == "__main__":
    raise SystemExit(main())
