"""Deficit-driven repair loop for obligation extraction.

Not a retry. A retry re-sends the same prompt and hopes for a different answer;
measured here, that is exactly what fails — `_extract_batch_llm_rows` already
retries an unparseable response twice and an output-budget failure reproduces
identically both times.

This loop instead:

1. **observes** verified state — the clause ledger, per-table coverage, the
   grounding check. Never the model's opinion of its own output. Asked to police
   itself in this pipeline, the model got *worse*: an in-prompt completeness rule
   cost 16 points of threshold accuracy on the obligations both runs matched.
   The research literature says the same thing about intrinsic self-critique;
   critics that work are grounded in tools.
2. **diagnoses** each gap into a kind. A clause nobody answered and a table that
   produced nothing are different failures and re-prompting cannot tell them
   apart.
3. **acts differently per kind** — that is the part a retry does not have.
4. **re-verifies and stops at a fixpoint**: repeat while the deficit set is
   shrinking. A deficit that survives its own repair is terminal and is never
   attempted again, which is what stops this degenerating into a retry.

Measured baseline it exists to beat (fixture A, 83 ground-truth rows, 3 runs on
Groq): 89.6% row recall ±0.6 with the family pack, ~19 clauses per run left
unaccounted, and one table — `scope_and_services`, six qualitative
Included/Excluded rows — at 0/6 in six consecutive runs.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

logger = logging.getLogger(__name__)

#: Hard ceiling on repair rounds. The literature on refinement loops is
#: consistent that gains converge in about three rounds and later rounds mostly
#: cost; the fixpoint check usually stops earlier than this anyway.
MAX_ROUNDS = 3

#: A deficit that has been attempted this many times without being repaired is
#: terminal. Without it, a clause the model will never answer is re-sent every
#: round and the loop is a retry with extra steps.
MAX_ATTEMPTS_PER_DEFICIT = 1


@dataclass(frozen=True)
class Deficit:
    """One verified gap, and enough context to repair *this kind* of gap."""

    kind: str
    target: str
    evidence: Dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> Tuple[str, str]:
        return (self.kind, self.target)


# ── observation ────────────────────────────────────────────────────────────


def diagnose(
    *,
    records: Sequence[Dict[str, Any]],
    candidates: Sequence[Dict[str, Any]],
    unaccounted: Iterable[str],
    required_classes: Optional[Sequence[str]] = None,
) -> List[Deficit]:
    """Turn verified signals into typed deficits.

    Every input here is a fact the pipeline computed, not a judgement: which
    source_ids never got a verdict, which table rows exist, which records failed
    the verbatim-quote check.
    """
    deficits: List[Deficit] = []
    by_source = {str(c.get("segment_id") or c.get("source_id")): c for c in candidates}

    # 1. Whole tables that produced nothing. Checked before individual clauses:
    #    a table at zero is one decision the model got wrong for the whole
    #    block, and re-prompting its rows one at a time reproduces that decision
    #    six times. `scope_and_services` has been 0/6 in six consecutive runs.
    rows_by_table: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        if candidate.get("table_id"):
            rows_by_table[str(candidate["table_id"])].append(candidate)

    covered_sources = {str(r.get("source_id")) for r in records if r.get("source_id")}
    for table_id, rows in rows_by_table.items():
        row_ids = {str(r.get("segment_id") or r.get("source_id")) for r in rows}
        if row_ids and not (row_ids & covered_sources):
            deficits.append(Deficit(
                kind="empty_table",
                target=table_id,
                evidence={
                    "table_type": rows[0].get("table_type"),
                    "caption": rows[0].get("section_path"),
                    "row_count": len(rows),
                    "source_ids": sorted(row_ids),
                },
            ))

    tables_already_flagged = {d.target for d in deficits}
    flagged_sources = {
        source
        for d in deficits
        for source in d.evidence.get("source_ids", [])
    }

    # 2. Individual clauses that got no verdict either way, excluding any already
    #    covered by an empty-table deficit — repairing the table repairs them.
    for source_id in sorted(set(map(str, unaccounted))):
        if source_id in flagged_sources:
            continue
        candidate = by_source.get(source_id)
        if candidate and str(candidate.get("table_id") or "") in tables_already_flagged:
            continue
        deficits.append(Deficit(
            kind="unanswered_clause",
            target=source_id,
            evidence={"text": (candidate or {}).get("text", ""),
                      "table_type": (candidate or {}).get("table_type")},
        ))

    # 3. Records whose quote could not be found in their source. Quarantined
    #    already, but quarantine is a label; a repair is a second chance to cite
    #    correctly before the record reaches a reviewer.
    for record in records:
        reasons = record.get("quarantine_reasons") or []
        if "quote_not_verbatim_in_source" in reasons:
            deficits.append(Deficit(
                kind="ungrounded_quote",
                target=str(record.get("kpi_id") or record.get("name") or ""),
                evidence={"source_id": record.get("source_id"), "name": record.get("name")},
            ))

    # 4. Obligation classes the pack says this family has and the register does
    #    not contain at all. `coverage.yaml` has carried these since the packs
    #    shipped and nothing has ever read them.
    if required_classes:
        present = {
            str(r.get("obligation_class") or "").strip().lower()
            for r in records
        }
        for obligation_class in required_classes:
            if obligation_class.strip().lower() not in present:
                deficits.append(Deficit(
                    kind="missing_class",
                    target=obligation_class,
                    evidence={},
                ))

    return deficits


# ── the loop ───────────────────────────────────────────────────────────────


RepairFn = Callable[[Deficit], List[Dict[str, Any]]]


@dataclass
class LoopReport:
    """What the loop did, in enough detail to tell repair from churn."""

    rounds: int = 0
    repaired: Dict[str, int] = field(default_factory=dict)
    attempted: Dict[str, int] = field(default_factory=dict)
    terminal: List[Tuple[str, str]] = field(default_factory=list)
    added_records: int = 0
    stopped_because: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "rounds": self.rounds,
            "attempted": self.attempted,
            "repaired": self.repaired,
            "terminal": [{"kind": k, "target": t} for k, t in self.terminal],
            "added_records": self.added_records,
            "stopped_because": self.stopped_because,
        }


def run_repair_loop(
    *,
    records: List[Dict[str, Any]],
    candidates: Sequence[Dict[str, Any]],
    unaccounted: Iterable[str],
    repair: RepairFn,
    required_classes: Optional[Sequence[str]] = None,
    max_rounds: int = MAX_ROUNDS,
) -> Tuple[List[Dict[str, Any]], LoopReport]:
    """Repair verified deficits until the set stops shrinking.

    `repair` performs one deficit's action and returns whatever records it
    recovered; the loop owns diagnosis, selection, verification and termination.
    Returns the augmented record list and a report of what actually moved.
    """
    report = LoopReport()
    attempted: Dict[Tuple[str, str], int] = defaultdict(int)
    terminal: Set[Tuple[str, str]] = set()
    working = list(records)
    remaining = set(map(str, unaccounted))

    previous_count: Optional[int] = None
    for round_number in range(1, max_rounds + 1):
        deficits = [
            d for d in diagnose(
                records=working,
                candidates=candidates,
                unaccounted=remaining,
                required_classes=required_classes,
            )
            if d.key not in terminal
        ]
        if not deficits:
            report.stopped_because = "no deficits remain"
            break

        # The fixpoint test. Not "did we run out of turns" — "did the last round
        # actually reduce the problem". A round that repairs nothing means the
        # remaining deficits are not the kind this loop can fix, and spending
        # another round on them is the retry behaviour being avoided.
        if previous_count is not None and len(deficits) >= previous_count:
            report.stopped_because = f"deficits stopped shrinking at {len(deficits)}"
            break
        previous_count = len(deficits)
        report.rounds = round_number

        logger.info(
            "Repair round %d: %d deficits (%s)",
            round_number,
            len(deficits),
            ", ".join(f"{k}={v}" for k, v in sorted(_count_kinds(deficits).items())),
        )

        for deficit in deficits:
            attempted[deficit.key] += 1
            report.attempted[deficit.kind] = report.attempted.get(deficit.kind, 0) + 1
            try:
                recovered = repair(deficit) or []
            except Exception as exc:                     # a failed repair is a
                logger.warning(                          # non-event, never an
                    "Repair of %s %s failed: %s",        # extraction failure
                    deficit.kind, deficit.target, exc,
                )
                recovered = []

            if recovered:
                working.extend(recovered)
                report.added_records += len(recovered)
                report.repaired[deficit.kind] = report.repaired.get(deficit.kind, 0) + 1
                remaining -= {str(r.get("source_id")) for r in recovered if r.get("source_id")}
                remaining -= set(deficit.evidence.get("source_ids") or [])
            elif attempted[deficit.key] >= MAX_ATTEMPTS_PER_DEFICIT:
                # Attempted, not repaired: this is as far as the loop gets. Say
                # so and stop touching it.
                terminal.add(deficit.key)
                report.terminal.append(deficit.key)
    else:
        report.stopped_because = f"reached the {max_rounds}-round ceiling"

    return working, report


def _count_kinds(deficits: Sequence[Deficit]) -> Dict[str, int]:
    counts: Dict[str, int] = defaultdict(int)
    for deficit in deficits:
        counts[deficit.kind] += 1
    return dict(counts)
