"""Dump obligation-extraction output to JSON so it can be scored.

Companion to ``testing/backend/scripts/score_obligation_extraction.py``.  That
scorer is deliberately stack-free; this script is the part that needs Mongo and
an LLM key.

Two modes:

``export``  Read the contract's already-stored obligations out of
            ``contract_kpis``.  Read-only.  Use this to score whatever the last
            run produced.

``run``     Re-run ``ContractKPIManager.extract_for_contract`` and dump the
            result.  Repeat with ``--runs N`` to measure run-to-run stability.
            **This replaces the contract's draft obligation register**, so it
            requires ``--yes``.  For the Baltia demo contract, reseed afterwards
            with ``python scripts/prepare_baltia_jfk_demo.py``.

``run`` mode also forces ``BALTIA_DEMO_REAL_EXTRACTION=1``.  Without it the demo
contract short-circuits to the labelled gold file and you would be scoring the
gold set against itself -- a clean 1.000 that means nothing.

Usage::

    python scripts/dump_obligation_extraction.py --mode export --hint baltia \\
        --out-dir ../../reports/extraction

    python scripts/dump_obligation_extraction.py --mode run --hint baltia \\
        --runs 3 --yes --out-dir ../../reports/extraction
"""

import argparse
import json
import os
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")


def _json_safe(value: Any) -> Any:
    """ObjectId/datetime -> string, so the dump is plain JSON."""
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _find_contract(collection, *, contract_id: Optional[str], hint: Optional[str]) -> Dict[str, Any]:
    from bson import ObjectId

    projection = {
        "_id": 1,
        "contract_name": 1,
        "projectId": 1,
        "ownerType": 1,
        "ownerId": 1,
        "index.status": 1,
        "index.content": 1,
        "body_text": 1,
    }
    if contract_id:
        contract = collection.find_one({"_id": ObjectId(contract_id)}, projection)
        if not contract:
            raise SystemExit(f"No contract with _id={contract_id}")
        return contract

    needle = (hint or "").lower()
    matches = [
        doc
        for doc in collection.find({}, projection)
        if needle in str(doc.get("contract_name") or "").lower()
    ]
    if not matches:
        raise SystemExit(f"No contract whose name contains {hint!r}")
    if len(matches) > 1:
        names = ", ".join(f"{doc['_id']} ({doc.get('contract_name')})" for doc in matches)
        raise SystemExit(f"{hint!r} matches {len(matches)} contracts; pass --contract-id. {names}")
    return matches[0]


def _stored_obligations(kpi_db, contract_id: str) -> List[Dict[str, Any]]:
    rows = list(kpi_db["contract_kpis"].find({"contract_id": contract_id}))
    return [_json_safe(row) for row in rows]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=("export", "run"), default="export")
    parser.add_argument("--contract-id")
    parser.add_argument("--hint", help="Substring of the contract name, e.g. 'baltia'.")
    parser.add_argument("--runs", type=int, default=1, help="run mode only: how many extractions to perform.")
    parser.add_argument("--provider", help="Override the AI provider for the run.")
    parser.add_argument("--out-dir", type=Path, default=Path("reports/extraction"))
    parser.add_argument("--user-id", default="extraction-scoring")
    parser.add_argument("--yes", action="store_true", help="Confirm that run mode replaces the draft register.")
    args = parser.parse_args(argv)

    if not args.contract_id and not args.hint:
        raise SystemExit("Pass --contract-id or --hint")
    if args.mode == "run" and not args.yes:
        raise SystemExit(
            "run mode re-extracts and replaces this contract's draft obligations. "
            "Re-run with --yes if that is what you want."
        )
    if args.mode == "run":
        # Must be set before the demo module is imported anywhere.
        os.environ["BALTIA_DEMO_REAL_EXTRACTION"] = "1"

    from core.database import collection, kpi_db  # noqa: E402 - after env defaults

    contract = _find_contract(collection, contract_id=args.contract_id, hint=args.hint)
    contract_id = str(contract["_id"])
    print(f"contract: {contract.get('contract_name')}  ({contract_id})")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    written: List[Path] = []

    if args.mode == "export":
        rows = _stored_obligations(kpi_db, contract_id)
        path = args.out_dir / "stored.json"
        path.write_text(json.dumps({"contract_id": contract_id, "kpis": rows}, indent=2))
        written.append(path)
        print(f"  exported {len(rows)} stored obligations -> {path}")
    else:
        from services.baltia_jfk_demo import real_extraction_enabled  # noqa: E402
        from services.kpi_manager import ContractKPIManager  # noqa: E402

        assert real_extraction_enabled(), "demo ground-truth bypass is still active"
        print("  demo ground-truth bypass: DISABLED for this run")

        manager = ContractKPIManager(kpi_db)
        for index in range(1, args.runs + 1):
            result = manager.extract_for_contract(
                contract_doc=contract,
                user_id=args.user_id,
                replace_drafts=True,
                ai_provider=args.provider,
            )
            rows = _stored_obligations(kpi_db, contract_id)
            path = args.out_dir / f"run_{index}.json"
            path.write_text(
                json.dumps(
                    {
                        "contract_id": contract_id,
                        "run": index,
                        "extraction_result": _json_safe(
                            {k: v for k, v in (result or {}).items() if k != "kpis"}
                        ),
                        "kpis": rows,
                    },
                    indent=2,
                )
            )
            written.append(path)
            print(f"  run {index}/{args.runs}: {len(rows)} obligations -> {path}")

    preds = " ".join(f"--pred {path}" for path in written)
    print("\nscore it with:")
    print(
        "  python testing/backend/scripts/score_obligation_extraction.py "
        f"--gold demo_data/baltia_jfk_ground_truth.json {preds} "
        "--report reports/obligation_extraction_baseline.json"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
