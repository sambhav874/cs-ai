#!/usr/bin/env python3
"""Extract one contract twice — without its family pack and with it — and score both.

This is the ablation the pack design has always demanded and never had: a pack
costs ~2,100 tokens on every batch of every run, and until the same document is
extracted both ways against the same ground truth, nobody knows whether it buys
anything.

Runs inside the worker container, where the database and the full extraction
stack are available:

    docker exec extractor-worker-1 python /app/backend/../ablate_pack.py \
        --contract-id <oid> --document A
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

from bson import ObjectId


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-id", required=True)
    parser.add_argument("--out", default="/tmp")
    parser.add_argument("--runs", type=int, default=1,
                        help="repeats per arm. One run cannot separate an effect from "
                             "run-to-run variance: the same document scored 79.5%% and "
                             "90.4%% on two identical-configuration runs.")
    parser.add_argument("--provider", default="groq")
    args = parser.parse_args()

    from core.database import collection, kpi_db
    from services.kpi_manager import ClauseLedger, ContractKPIManager
    from services.obligation_packs import PackResolution, load_pack, resolve_family

    contract = collection.find_one({"_id": ObjectId(args.contract_id)})
    if not contract:
        raise SystemExit("contract not found")
    name = contract.get("contract_name") or "contract"

    manager = ContractKPIManager(kpi_db)
    candidates = manager._load_candidate_chunks(contract)
    print(f"contract   : {name}")
    print(f"candidates : {len(candidates)} "
          f"({sum(1 for c in candidates if c.get('chunk_level') == 'table_row')} table rows)")

    body = (contract.get("index") or {}).get("content") or ""
    with_pack = resolve_family(title=name, body=body, packs=manager._candidate_packs(contract))
    base_only = PackResolution(load_pack("_base"), 0.0, [], "ablation: pack withheld")

    results = {}
    for arm, resolution in (("without_pack", base_only), ("with_pack", with_pack)):
        for run in range(1, args.runs + 1):
            label = f"{arm}_run{run}"
            print(f"\n=== {label} ({resolution.pack.id if resolution.pack else 'none'}) ===", flush=True)
            ledger = ClauseLedger()
            records = manager._extract_kpis_with_llm(
                candidates,
                contract_id=args.contract_id,
                project_id=None,
                contract_name=name,
                user_id="ablation",
                run_id=f"ablate_{label}",
                provider=args.provider,
                ledger=ledger,
                pack_resolution=resolution,
            )
            tally = ledger.finalize()
            path = Path(args.out) / f"ablate_{label}.json"
            path.write_text(json.dumps(records, indent=2, default=str))
            results[label] = {"records": len(records), "ledger": tally, "path": str(path)}
            print(f"records    : {len(records)}")
            print(f"clauses    : {tally['extracted']} extracted, {tally['rejected']} rejected, "
                  f"{tally['lost']} lost ({tally['accounted_ratio'] * 100:.1f}% accounted)")
            print(f"lost why   : {tally['lost_reasons']}", flush=True)

    Path(args.out, "ablate_summary.json").write_text(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
