#!/usr/bin/env python3
"""Print the exact prompt sent to the model for one batch. Makes no LLM call.

The prompt is assembled from four things that live in different files — the
extraction rules, the rendered family pack, the clause batch, and the output
contract — so nobody has ever seen the whole thing in one place. That is a bad
property for the single most important string in the system: a pack that got
truncated, a table row that arrived mangled, or a rule that never made it in are
all invisible until you read what actually gets sent.

    python3 testing/backend/scripts/dump_extraction_prompt.py \
        --contract sample_projects/corpus/A_AnnexB_1.0_2022.pdf --pack iata_ground_handling
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from unittest.mock import MagicMock

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps" / "intelligence"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--contract", type=Path, required=True,
                        help=".pdf, .md or .txt — the document the clauses come from")
    parser.add_argument("--pack", default="auto",
                        help="'auto' to resolve, 'none' for no pack, or a family id")
    parser.add_argument("--clauses", type=int, default=3, help="clauses to include in the batch")
    parser.add_argument("--full", action="store_true", help="print every clause, not a sample")
    args = parser.parse_args()

    from services.kpi_manager import ContractKPIManager
    from services.obligation_packs import (
        estimate_tokens, load_pack, render_pack_block, resolve_family,
    )

    if args.contract.suffix.lower() == ".pdf":
        import fitz
        document = fitz.open(str(args.contract))
        text = "\n".join(page.get_text() for page in document)
    else:
        text = args.contract.read_text(encoding="utf-8")

    manager = ContractKPIManager(database=MagicMock())
    manager.vector_collection = None

    if args.pack == "none":
        pack = None
    elif args.pack == "auto":
        pack = resolve_family(title=args.contract.stem, body=text).pack
    else:
        pack = load_pack(args.pack)
    pack_block = render_pack_block(pack)

    contract_doc = {"_id": "dump", "index": {"content": text}}
    rows = manager._table_row_candidates(contract_doc)
    candidates = rows or [{
        "text": text[:4000], "segment_id": "dump:prose_0", "section_path": "Document",
    }]
    records = manager._candidate_clause_records(candidates)
    batch = records if args.full else records[: args.clauses]

    prompt = manager._build_kpi_llm_prompt(
        contract_name=args.contract.stem, records=batch, pack_block=pack_block,
    )

    print("=" * 100)
    print(f"document      : {args.contract.name}")
    print(f"pack          : {pack.id + ' v' + str(pack.version) if pack else 'none'}"
          f"{'  (' + str(estimate_tokens(pack_block)) + ' tokens)' if pack_block else ''}")
    print(f"clauses shown : {len(batch)} of {len(records)} candidate clauses "
          f"({len(rows)} of them table rows)")
    print(f"prompt size   : {len(prompt)} chars ≈ {estimate_tokens(prompt)} tokens")
    print("=" * 100)
    print(prompt)
    print("=" * 100)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
