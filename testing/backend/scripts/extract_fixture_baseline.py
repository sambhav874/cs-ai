#!/usr/bin/env python3
"""Run the real extraction pipeline over a fixture contract, in memory.

Produces the Phase 0 baseline — the numbers every later phase gate is stated
against — without touching a database. It drives the *real*
`ContractKPIManager._extract_kpis_with_llm`: real segmenter, real Stage-1
screen, real prompt, real provider. Only the database is fake, and nothing is
written to it.

**Every LLM response is cached to disk**, keyed by a hash of the exact prompt
plus provider and model. Re-running is free, and re-scoring costs nothing at
all — which matters, because most questions you want to ask of a baseline are
scoring questions, not generation questions. Delete the cache directory to force
fresh calls.

It also records the two numbers that answer D3 (is the Stage-1 screen worth 40%
of the call budget?): how many clause records went into Stage-1 and how many
survived it.

Usage::

    cd apps/intelligence
    poetry run python ../../testing/backend/scripts/extract_fixture_baseline.py \\
        --fixture ../../final_evaluation/datasets/kpi_contracts/01_*.md \\
        --out /tmp/baseline_01.json

Then score it::

    python testing/backend/scripts/score_obligation_coverage.py \\
        --contract <same fixture> --pred /tmp/baseline_01.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps" / "intelligence"))


class FakeCollection:
    """Enough of a collection for the manager's constructor. Writes go nowhere."""

    def __init__(self, name: str = "") -> None:
        self.name = name
        self.docs: List[Dict[str, Any]] = []

    def find(self, *_a, **_k):
        return iter(())

    def find_one(self, *_a, **_k):
        return None

    def insert_one(self, doc, *_a, **_k):
        self.docs.append(doc)
        return type("R", (), {"inserted_id": len(self.docs)})()

    def update_one(self, *_a, **_k):
        return type("R", (), {"matched_count": 0, "modified_count": 0, "upserted_id": None})()

    def delete_many(self, *_a, **_k):
        return type("R", (), {"deleted_count": 0})()

    def bulk_write(self, *_a, **_k):
        return type("R", (), {"upserted_count": 0, "modified_count": 0})()

    def create_index(self, *_a, **_k):
        return None

    def count_documents(self, *_a, **_k):
        return 0

    def estimated_document_count(self, *_a, **_k):
        return 0


class FakeDB:
    def __init__(self) -> None:
        self.collections: Dict[str, FakeCollection] = {}

    def __getitem__(self, name: str) -> FakeCollection:
        return self.collections.setdefault(name, FakeCollection(name))


def build_candidates(text: str, contract_id: str, contract_name: str, level: str | None) -> List[Dict[str, Any]]:
    """Mirror the candidate shape `_load_candidate_chunks` yields, from raw text."""
    from services.contract_agent.rag.segmentation import DocumentSegmenter

    _clean, segments = DocumentSegmenter().segment_text_with_page_markers(text)
    candidates: List[Dict[str, Any]] = []
    for segment in segments:
        seg_level = segment.chunk_level or segment.type
        if level and seg_level != level:
            continue
        if not (segment.text or "").strip():
            continue
        candidates.append({
            "text": segment.text,
            "contract_id": contract_id,
            "contract_name": contract_name,
            "project_id": None,
            "segment_id": segment.id,
            "chunk_level": seg_level,
            "section_path": segment.section_path or "Document",
            "section_tags": segment.section_tags or [],
            "value_types": segment.value_types or [],
            "page_number": segment.page_number,
            "page_start": segment.page_start,
            "page_end": segment.page_end,
            "char_start": segment.char_start,
            "char_end": segment.char_end,
        })
    return candidates


def install_cache(manager, cache_dir: Path, provider: str, stats: Dict[str, int]):
    """Wrap `_query_kpi_llm_json` with a disk cache and a call counter."""
    from core.config import settings

    cache_dir.mkdir(parents=True, exist_ok=True)
    model = getattr(settings, "model_name", "") or ""
    original = manager._query_kpi_llm_json

    def cached(prompt: str, *, provider: str = provider, max_tokens_override=None):
        key = hashlib.sha256(f"{provider}|{model}|{max_tokens_override}|{prompt}".encode()).hexdigest()
        path = cache_dir / f"{key}.json"
        if path.exists():
            stats["cache_hits"] += 1
            return json.loads(path.read_text(encoding="utf-8"))
        stats["llm_calls"] += 1
        result = original(prompt, provider=provider, max_tokens_override=max_tokens_override)
        path.write_text(json.dumps(result, default=str), encoding="utf-8")
        return result

    manager._query_kpi_llm_json = cached


def install_stage1_probe(manager, stats: Dict[str, int]):
    """Record how much the Stage-1 screen actually rejects. This answers D3."""
    original = manager._filter_kpi_candidates_with_llm

    def probed(records, provider):
        stats["stage1_in"] = len(records)
        kept = original(records, provider=provider)
        stats["stage1_kept"] = len(kept)
        return kept

    manager._filter_kpi_candidates_with_llm = probed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--provider", default=None, help="default: the configured provider")
    parser.add_argument("--level", default=None, help="restrict to one chunk level, e.g. meso (D2)")
    parser.add_argument("--pack", default="none",
                        help="contract-family pack: 'none' (the _base-only arm of an ablation), "
                             "'auto' (resolve from the document, production behaviour), or a "
                             "family id to pin. Changing this changes the prompt, so each arm "
                             "has its own cache entries.")
    parser.add_argument("--cache-dir", type=Path,
                        default=REPO / ".extraction_cache",
                        help="LLM response cache; delete it to force fresh calls")
    args = parser.parse_args()

    from core.config import settings
    from services.kpi_manager import ClauseLedger, ContractKPIManager
    from services.obligation_packs import PackResolution, load_pack, resolve_family

    provider = (args.provider or getattr(settings, "ai_provider", None) or "groq").lower()
    text = args.fixture.read_text(encoding="utf-8")
    contract_id = f"baseline_{args.fixture.stem[:24]}"
    contract_name = args.fixture.stem

    manager = ContractKPIManager(database=FakeDB())
    manager.vector_collection = None  # never read chunks from a database here

    stats: Dict[str, int] = {"llm_calls": 0, "cache_hits": 0, "stage1_in": 0, "stage1_kept": 0}
    install_cache(manager, args.cache_dir, provider, stats)
    install_stage1_probe(manager, stats)

    if args.pack == "none":
        pack_resolution = None
    elif args.pack == "auto":
        pack_resolution = resolve_family(title=contract_name, body=text)
    else:
        pack_resolution = PackResolution(load_pack(args.pack), 1.0, ["pinned"], "pinned on the command line")

    candidates = build_candidates(text, contract_id, contract_name, args.level)
    print(f"fixture      : {args.fixture.name}")
    # Report the model the factory will actually resolve for this provider, not
    # settings.model_name — that is the Groq setting, and printing it while
    # running Gemini reported the wrong model in the one place you would check.
    from services.contract_agent.graph.model_factory import _resolve_model_name
    resolved_model = _resolve_model_name(provider, lightweight=False, overrides=None)
    print(f"provider     : {provider}  model: {resolved_model}")
    print(f"chunk level  : {args.level or 'all (production behaviour)'}")
    if pack_resolution and pack_resolution.pack:
        print(f"pack         : {pack_resolution.pack.id} v{pack_resolution.pack.version} "
              f"(confidence {pack_resolution.confidence:.2f}) — {pack_resolution.reason}")
    else:
        print("pack         : none (_base-only arm)")
    print(f"candidates   : {len(candidates)}")
    print("running extraction ...", flush=True)

    started = time.time()
    ledger = ClauseLedger()
    records = manager._extract_kpis_with_llm(
        candidates,
        contract_id=contract_id,
        project_id=None,
        contract_name=contract_name,
        user_id="baseline",
        run_id="baseline_run",
        provider=provider,
        ledger=ledger,
        pack_resolution=pack_resolution,
    )
    elapsed = time.time() - started
    clause_ledger = ledger.finalize()

    payload = {
        "fixture": args.fixture.name,
        "provider": provider,
        "model": getattr(settings, "model_name", None),
        "chunk_level": args.level,
        "pack": (
            {
                "id": pack_resolution.pack.id,
                "version": pack_resolution.pack.version,
                "confidence": pack_resolution.confidence,
                "reason": pack_resolution.reason,
            }
            if pack_resolution and pack_resolution.pack
            else None
        ),
        "candidate_count": len(candidates),
        "elapsed_seconds": round(elapsed, 1),
        "stats": stats,
        "clause_ledger": clause_ledger,
        "records": records,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    kept, went_in = stats["stage1_kept"], stats["stage1_in"]
    print()
    print(f"records      : {len(records)}")
    print(f"llm calls    : {stats['llm_calls']}  (cache hits {stats['cache_hits']})")
    if went_in:
        print(f"stage 1      : {went_in} in -> {kept} kept "
              f"({(1 - kept / went_in) * 100:.1f}% rejected)   <- D3")
    print(f"clause ledger: {clause_ledger['extracted']} extracted, "
          f"{clause_ledger['rejected']} rejected, "
          f"{clause_ledger['lost']} LOST "
          f"({clause_ledger['accounted_ratio'] * 100:.1f}% accounted)")
    if clause_ledger["lost_reasons"]:
        print(f"lost reasons : {clause_ledger['lost_reasons']}")
    print(f"elapsed      : {elapsed:.1f}s")
    print(f"written      : {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
