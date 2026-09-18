"""What the contract promised the rates would do, against what they did.

Every other part of this tracks what changed. This is the part that says
whether the change was allowed. A contract that fixes an annual uplift at 3%
and a rate card that went up 6% is the finding a customer is actually paying to
hear about, and it is invisible to anything that reads only one document or
only one version.

Two halves. Reading the promise out of the contract text, which is pattern
matching over the sentence that states it, and comparing it against the movement
the schedule tracker already measured. Both are conservative: an unmatched
clause is reported as unread rather than guessed at, and a comparison the dates
cannot support is not made at all. A wrong variance figure would send someone to
their counterparty with a number that does not hold up, which is worse than no
figure.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# How far apart a percentage and the language that gives it meaning may sit and
# still belong to each other. A sentence is the unit; this bounds the scan when
# sentence splitting fails on a table-heavy page.
_WINDOW = 400

# Words that make a percentage an escalation rather than a discount, a tax, or
# a service credit. Without this the first percentage in any contract gets read
# as the uplift.
_ESCALATION_TERMS = re.compile(
    r"\b(increase[sd]?|escalat\w*|indexation|index-linked|uplift|adjust\w*|"
    r"revis\w*|rise[sn]?)\b",
    re.IGNORECASE,
)

# Words that make it periodic. A one-off 5% increase is not an escalation rule
# and must not be compared against every later revision.
_PERIODIC_TERMS = re.compile(
    r"\b(per annum|annually|annual|each anniversary|every year|yearly|"
    r"each year|p\.a\.)\b",
    re.IGNORECASE,
)

# An index-linked promise has no fixed number in the contract at all.
_INDEX_TERMS = re.compile(
    r"\b(CPI|RPI|HICP|consumer price index|retail price index|"
    r"inflation|price index)\b",
    re.IGNORECASE,
)

# Language that caps rather than fixes. "shall not exceed 5%" permits anything
# up to 5, so a 3% move is compliant — the opposite of how a fixed rate reads.
_CAP_TERMS = re.compile(
    r"\b(not exceed|no more than|capped at|maximum of|up to|至多)\b",
    re.IGNORECASE,
)

_PERCENT = re.compile(r"(\d{1,3}(?:[.,]\d{1,4})?)\s*(?:%|per\s*cent|percent)", re.IGNORECASE)

FIXED = "fixed"
CAPPED = "capped"
INDEXED = "indexed"


def _sentences(text: str) -> List[Tuple[int, str]]:
    """Offsets and text of candidate sentences.

    Split on sentence punctuation and line breaks both: contract clauses are
    frequently a numbered line with no full stop at all, and splitting only on
    punctuation would swallow a whole page into one "sentence".
    """
    spans: List[Tuple[int, str]] = []
    start = 0
    for match in re.finditer(r"(?<=[.;:])\s+|\n+", text):
        end = match.start()
        if end > start:
            spans.append((start, text[start:end]))
        start = match.end()
    if start < len(text):
        spans.append((start, text[start:]))
    return [(offset, chunk) for offset, chunk in spans if chunk.strip()]


def extract_escalation_clauses(content: str) -> List[Dict[str, Any]]:
    """Every stated rule about how charges move over time.

    Returns one record per clause found, each carrying the sentence it came
    from so the finding can be re-read against the document rather than
    believed. A document that states no rule returns nothing, which is a
    different answer from a rule of zero.
    """
    if not content:
        return []

    findings: List[Dict[str, Any]] = []
    seen: set = set()

    for offset, sentence in _sentences(content):
        if len(sentence) > _WINDOW * 2:
            sentence = sentence[: _WINDOW * 2]
        if not _ESCALATION_TERMS.search(sentence) and not _INDEX_TERMS.search(sentence):
            continue
        if not _PERIODIC_TERMS.search(sentence):
            continue

        quote = " ".join(sentence.split())
        if quote in seen:
            continue

        percentages = [
            float(raw.replace(",", "."))
            for raw, in ((m.group(1),) for m in _PERCENT.finditer(sentence))
        ]
        indexed = bool(_INDEX_TERMS.search(sentence))
        capped = bool(_CAP_TERMS.search(sentence))

        if percentages:
            # The same rate is routinely written twice — "three per cent
            # (3.00%)" — so a single distinct value is one promise, not two.
            distinct = sorted(set(round(p, 4) for p in percentages))
            rate = distinct[0] if len(distinct) == 1 else max(distinct)
            basis = INDEXED if indexed else (CAPPED if capped else FIXED)
            ambiguous = len(distinct) > 1
        elif indexed:
            rate = None
            basis = INDEXED
            ambiguous = False
        else:
            continue

        seen.add(quote)
        findings.append({
            "basis": basis,
            "rate_pct": rate,
            "compounded": bool(re.search(r"compound", sentence, re.IGNORECASE)),
            # More than one distinct percentage in one sentence means the
            # sentence says something this cannot read — a floor and a ceiling,
            # or a rate that differs by service. Reported, never averaged.
            "ambiguous": ambiguous,
            "quote": quote[:400],
            "char_start": offset,
        })

    return findings


def _round(value: float) -> float:
    """Round for display without producing negative zero.

    "-0.00%" reads as a real if tiny shortfall rather than as an exact match,
    which is the opposite of what it means.
    """
    rounded = round(value, 2)
    return 0.0 if rounded == 0 else rounded


def _years_between(earlier: Optional[str], later: Optional[str]) -> Optional[float]:
    """Years between two ISO dates, or None if they cannot be compared."""
    if not earlier or not later:
        return None
    try:
        from datetime import date

        start = date.fromisoformat(earlier[:10])
        end = date.fromisoformat(later[:10])
    except (ValueError, TypeError):
        return None
    days = (end - start).days
    if days <= 0:
        return None
    years = days / 365.25

    # Snap to the anniversary. Contracts escalate on a date, not on a fraction
    # of a year, so a leap year turning an exact anniversary into 1.002 years
    # is measurement noise — and compounding it reports a 3% rule as allowing
    # 3.01%, which reads as though the tool cannot do arithmetic. Only whole
    # years within a week are snapped; a genuine half-year gap stays a half.
    nearest = round(years)
    if nearest >= 1 and abs(years - nearest) <= 0.02:
        return float(nearest)
    return years


def expected_movement(rate_pct: float, years: float, *, compounded: bool) -> float:
    """What the promised rule produces over a period.

    Compounded and simple are genuinely different over more than one year, and
    a contract that says "compounded annually" has said which. Two years at 3%
    is 6.09% compounded and 6.00% simple — small, and exactly the size of gap
    that makes a variance report look wrong when it is not.
    """
    if compounded:
        return ((1 + rate_pct / 100) ** years - 1) * 100
    return rate_pct * years


def check_escalation(
    clauses: List[Dict[str, Any]],
    lineages: List[Dict[str, Any]],
    *,
    tolerance_pct: float = 0.15,
) -> List[Dict[str, Any]]:
    """Compare each measured rate movement against the promised rule.

    `tolerance_pct` absorbs rounding: a card uplifted 3% and rounded to two
    decimals per line does not land on exactly 3.00% in aggregate, and
    reporting that as a breach would make the check useless on its first run.

    Only fixed and capped rules are checked. An index-linked rule promises a
    number nobody has here — the index value for that year is not in the
    contract — so it is reported as uncheckable rather than assumed.
    """
    usable = [c for c in clauses if c["basis"] in (FIXED, CAPPED) and not c["ambiguous"]]
    if not usable:
        return []
    # The strictest stated rule governs. Where a contract states several, the
    # narrower one is the one a counterparty would be held to.
    clause = min(usable, key=lambda c: c["rate_pct"] if c["rate_pct"] is not None else 1e9)
    if clause["rate_pct"] is None:
        return []

    findings: List[Dict[str, Any]] = []
    for lineage in lineages:
        versions = lineage.get("versions") or []
        for earlier, later in zip(versions, versions[1:]):
            observed = later.get("observed_pct")
            if observed is None:
                # Rows moved by different amounts, so there is no single figure
                # to hold against a single promised rate.
                continue
            years = _years_between(
                earlier.get("effective_date"), later.get("effective_date")
            )
            if years is None:
                continue

            expected = expected_movement(
                clause["rate_pct"], years, compounded=clause["compounded"]
            )
            variance = observed - expected
            if clause["basis"] == CAPPED and variance <= tolerance_pct:
                # A cap permits anything under it.
                status = "within_cap"
            elif abs(variance) <= tolerance_pct:
                status = "as_promised"
            elif variance > 0:
                status = "above_promised"
            else:
                status = "below_promised"

            findings.append({
                "signature": lineage.get("signature"),
                "caption": lineage.get("caption"),
                "status": status,
                "severity": "warning" if status == "above_promised" else "info",
                "observed_pct": _round(observed),
                "expected_pct": _round(expected),
                "variance_pct": _round(variance),
                "years": round(years, 2),
                "basis": clause["basis"],
                "rate_pct": clause["rate_pct"],
                "compounded": clause["compounded"],
                "clause_quote": clause["quote"],
                "from_contract": earlier.get("contract_name"),
                "to_contract": later.get("contract_name"),
                "from_date": earlier.get("effective_date"),
                "to_date": later.get("effective_date"),
            })

    findings.sort(key=lambda f: (f["severity"] != "warning", -abs(f["variance_pct"])))
    return findings


def render_escalation(
    clauses: List[Dict[str, Any]],
    findings: List[Dict[str, Any]],
) -> str:
    """As the agent reads it."""
    if not clauses:
        return (
            "No document in this project states a rule for how charges move "
            "over time, so there is nothing to hold the rate changes against."
        )

    lines = ["What the documents promise about rate movement:"]
    for clause in clauses:
        if clause["basis"] == INDEXED and clause["rate_pct"] is None:
            stated = "linked to a published index"
        elif clause["basis"] == CAPPED:
            stated = f'capped at {clause["rate_pct"]}%'
        else:
            stated = f'{clause["rate_pct"]}%'
        compounding = ", compounded" if clause["compounded"] else ""
        warn = " · states more than one rate, not read" if clause["ambiguous"] else ""
        lines.append(f'- {stated} per year{compounding}{warn} — "{clause["quote"][:200]}"')

    indexed_only = all(c["basis"] == INDEXED and c["rate_pct"] is None for c in clauses)
    if indexed_only:
        lines.append(
            "This rule is index-linked, so what it permits depends on an index "
            "value that is not in these documents. The movements below cannot be "
            "checked against it without that figure."
        )
        return "\n".join(lines)

    if not findings:
        lines.append(
            "No rate movement in this project could be compared against that rule: "
            "either no schedule moved by a single uniform figure, or the versions "
            "carry no effective dates to measure a period between."
        )
        return "\n".join(lines)

    lines.append("")
    lines.append("Measured against it:")
    for finding in findings:
        verdict = {
            "as_promised": "as promised",
            "within_cap": "within the cap",
            "above_promised": "ABOVE what the contract permits",
            "below_promised": "below what the contract provides for",
        }[finding["status"]]
        lines.append(
            f'- "{finding["caption"]}" {finding["from_date"]} → {finding["to_date"]} '
            f'({finding["years"]}y): moved {finding["observed_pct"]:+.2f}%, '
            f'rule allows {finding["expected_pct"]:+.2f}% — {verdict} '
            f'({finding["variance_pct"]:+.2f}%)'
        )
    over = [f for f in findings if f["status"] == "above_promised"]
    if over:
        lines.append(
            f"{len(over)} movement(s) exceed the stated rule. Quote the clause and "
            "both rate cards when raising it; do not state a breach without them."
        )
    return "\n".join(lines)


def project_escalation(
    project_id: str,
    *,
    contract_query: Dict[str, Any],
    links: Optional[Dict[str, str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Every escalation rule stated in the project, and how the rates measured
    against it.

    Read from the documents on each call rather than stored at ingestion.
    The rule is cheap to find, and a stored one would go stale the moment a
    later document changed it — which is exactly the project this matters in.
    """
    from core.database import collection as contracts_collection
    from services.schedule_registry import project_schedules

    clauses: List[Dict[str, Any]] = []
    for contract in contracts_collection.find(
        contract_query, {"_id": 1, "contract_name": 1, "index.content": 1}
    ):
        content = (contract.get("index") or {}).get("content") or ""
        for clause in extract_escalation_clauses(content):
            clause["contract_id"] = str(contract["_id"])
            clause["contract_name"] = contract.get("contract_name") or ""
            clauses.append(clause)

    if not clauses:
        return [], []

    lineages, _documents = project_schedules(
        project_id, contract_query=contract_query, links=links
    )
    return clauses, check_escalation(clauses, lineages)
