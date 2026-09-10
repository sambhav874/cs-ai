#!/usr/bin/env python3
"""Validate every shipped obligation pack. Read-only, no network, no database.

Run in CI on any change to `packs/obligations/`, the extraction prompt, or
`kpi_manager.py`. A pack that instructs, declares a currency, or overruns its
context budget fails the build here rather than reaching every clause of every
contract in its family.

    python3 apps/backend/scripts/lint_obligation_packs.py
"""

from __future__ import annotations

import sys
from pathlib import Path

APP_BACKEND = Path(__file__).resolve().parents[1]
if str(APP_BACKEND) not in sys.path:
    sys.path.insert(0, str(APP_BACKEND))

from services.obligation_packs import (  # noqa: E402
    BASE_PACK_ID,
    PackError,
    available_families,
    estimate_tokens,
    load_pack,
    render_pack_block,
)

REQUIRED_COVERAGE_KEYS = ("span_coverage_floor", "anchor_recall_floor", "grounding_floor")


def main() -> int:
    failures: list[str] = []

    try:
        base = load_pack(BASE_PACK_ID)
        if not base.sections:
            failures.append("_base has no sections")
    except PackError as exc:
        failures.append(f"_base: {exc}")

    families = available_families()
    if not families:
        print("no family packs found; nothing to lint")
        return 0

    for family_id in families:
        try:
            pack = load_pack(family_id)
        except PackError as exc:
            failures.append(f"{family_id}: {exc}")
            continue

        rendered = render_pack_block(pack)
        tokens = estimate_tokens(rendered)
        status = "ok"

        if tokens > pack.max_context_tokens:
            failures.append(
                f"{family_id}: renders at {tokens} tokens, over its {pack.max_context_tokens} budget "
                "even after truncation"
            )
            status = "OVER BUDGET"

        # A pack may declare itself unvalidated instead of inventing floors — a
        # floor written from ambition fails the build without measuring
        # anything. The declaration is loud on purpose: it has to be visible
        # every time the linter runs, not buried in a comment.
        unvalidated = bool(pack.coverage.get("unvalidated"))
        missing = [key for key in REQUIRED_COVERAGE_KEYS if key not in pack.coverage]
        if unvalidated:
            status = f"UNVALIDATED — {pack.coverage.get('unvalidated_reason') or 'no reason given'}"
        elif missing:
            failures.append(
                f"{family_id}: coverage.yaml is missing {', '.join(missing)}. Set them from a "
                "measured run, or declare 'unvalidated: true' with a reason."
            )
            status = "NO FLOORS"

        if pack.fixture and not (APP_BACKEND.parents[1] / pack.fixture).is_file():
            failures.append(f"{family_id}: fixture '{pack.fixture}' does not exist")
            status = "NO FIXTURE"

        print(f"  {family_id:28} v{pack.version}  {tokens:>5} tok / {pack.max_context_tokens}  {status}")

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(f"\n{len(families)} pack(s) clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
