#!/usr/bin/env python3
"""Report fee-schedule KPI records written before the id was contract-scoped.

Background
----------
`_consolidate_multi_tier_schedules` used to seed a schedule record's `kpi_id`
from the schedule title alone::

    kpi_id = "kpi_sch_" + md5(title)[:12]

`kpi_id` carries a globally unique index (`_ensure_indexes`) and the bulk upsert
in `extract_for_contract` filters on `kpi_id` by itself, so two contracts that
each produced a similarly-titled schedule hashed to the same id and the second
extraction `$set` its whole document — `contract_id` included — over the first.

What this script does
---------------------
Recomputes each `kpi_sch_*` record's id under the fixed, contract-scoped scheme
and reports the ones that do not match. Those are pre-fix records: each is a
record that *could* have been overwritten from another contract, and any record
that actually was overwritten is already gone — the unique index left only the
winner behind, so there is nothing to restore. The fix for an affected contract
is to re-extract it.

**This script does not write anything.** It deliberately does not re-key the
records it finds: `contract_kpi_actuals` and `contract_kpi_breaches` reference
KPIs by `kpi_id`, so rewriting an id here would orphan a contract's recorded
actuals and its breach history. Re-extraction produces correctly-scoped ids for
draft records, and approved records are skipped by the upsert and keep theirs.

Usage
-----
    python apps/backend/scripts/check_schedule_kpi_id_collisions.py
    python apps/backend/scripts/check_schedule_kpi_id_collisions.py --json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def scoped_schedule_id(contract_id: str, title: str) -> str:
    """The id `_consolidate_multi_tier_schedules` produces after the fix."""
    return f"kpi_sch_{hashlib.md5(f'{contract_id}:{title}'.encode()).hexdigest()[:12]}"


def legacy_schedule_id(title: str) -> str:
    """The id it produced before the fix."""
    return f"kpi_sch_{hashlib.md5(title.encode()).hexdigest()[:12]}"


def scan(kpis) -> Dict[str, Any]:
    projection = {"_id": 0, "kpi_id": 1, "contract_id": 1, "name": 1, "status": 1, "governance": 1}
    suspect: List[Dict[str, Any]] = []
    total = 0
    by_title: Dict[str, set] = defaultdict(set)

    for doc in kpis.find({"kpi_id": {"$regex": "^kpi_sch_"}}, projection):
        total += 1
        kpi_id = str(doc.get("kpi_id") or "")
        contract_id = str(doc.get("contract_id") or "")
        name = str(doc.get("name") or "")
        by_title[name].add(contract_id)

        if kpi_id == scoped_schedule_id(contract_id, name):
            continue  # written after the fix

        status = doc.get("status") or (doc.get("governance") or {}).get("status")
        suspect.append({
            "kpi_id": kpi_id,
            "contract_id": contract_id,
            "name": name,
            "status": status,
            "matches_legacy_scheme": kpi_id == legacy_schedule_id(name),
            "expected_scoped_id": scoped_schedule_id(contract_id, name),
        })

    # A title seen under more than one contract is where a collision could have
    # happened at all — worth calling out separately from the raw pre-fix count.
    contested = {title: sorted(ids) for title, ids in by_title.items() if len(ids) > 1}

    return {
        "schedule_records_total": total,
        "pre_fix_records": len(suspect),
        "titles_shared_across_contracts": contested,
        "records": suspect,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true", help="emit the full report as JSON")
    args = parser.parse_args()

    try:
        from core.database import kpi_db
    except Exception as exc:  # pragma: no cover - environment problem, not logic
        print(f"Could not connect to the KPI database: {exc}", file=sys.stderr)
        print("Set MONGODB_URI (and the other required settings) and retry.", file=sys.stderr)
        return 2

    report = scan(kpi_db["contract_kpis"])

    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return 0

    print(f"Schedule records scanned: {report['schedule_records_total']}")
    print(f"Written before the contract-scoped id fix: {report['pre_fix_records']}")

    contested = report["titles_shared_across_contracts"]
    if contested:
        print(f"\nTitles that appear under more than one contract ({len(contested)}) — "
              "these are the ones a collision could have affected:")
        for title, contract_ids in sorted(contested.items()):
            print(f"  {title!r}: {', '.join(contract_ids)}")
        print("\nRe-extract those contracts. Any record that was actually overwritten is gone —")
        print("the unique index kept only the winner — so there is nothing to restore in place.")
    elif report["pre_fix_records"]:
        print("\nNo title is shared across contracts, so no collision has occurred yet.")
        print("The pre-fix records above are safe; they simply keep their old ids until re-extraction.")
    else:
        print("\nNothing to do.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
