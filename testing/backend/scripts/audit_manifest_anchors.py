#!/usr/bin/env python3
"""Audit the manifest's evaluation anchors against the contracts themselves.

`manifest.json` supplies 60 hand-written must-find values, and they are the only
external ground truth in the repo. They are also hand-written, so some are wrong:
this script found three anchors naming values that do not appear anywhere in
their own contract, and one written as a description rather than a quotable
string.

That matters because anchor recall is a 100% gate. Gating on an anchor the
contract cannot satisfy fails the build for a defect in the test, not the
extractor — so audit the anchors before trusting a failure.

Usage::

    python testing/backend/scripts/audit_manifest_anchors.py
    python testing/backend/scripts/audit_manifest_anchors.py --strict   # non-zero exit on any bad anchor
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Dict, List, Tuple

REPO = Path(__file__).resolve().parents[3]
CONTRACTS = REPO / "final_evaluation" / "datasets" / "kpi_contracts"

# Contracts spell small numbers; anchors use numerals.
NUMBER_WORDS: Dict[str, str] = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
    "11": "eleven", "12": "twelve", "13": "thirteen", "14": "fourteen",
    "15": "fifteen", "16": "sixteen", "17": "seventeen", "18": "eighteen",
    "19": "nineteen", "20": "twenty", "24": "twenty-four", "30": "thirty",
    "35": "thirty-five", "45": "forty-five", "60": "sixty", "90": "ninety",
}
_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").translate(_DASHES)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[*_`~]+", "", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def variants(value: str) -> List[str]:
    """The anchor as written, plus its spelled-out-number form."""
    normalized = norm(value)
    out = [normalized]
    match = re.match(r"([\d.]+)(.*)", normalized)
    if match and match.group(1) in NUMBER_WORDS:
        out.append(f"{NUMBER_WORDS[match.group(1)]}{match.group(2)}")
    return out


def is_descriptive(value: str) -> bool:
    """A prose description rather than a value that can be quoted verbatim."""
    normalized = norm(value)
    return "+" in normalized or normalized.count(" ") > 3


def audit() -> Tuple[List[dict], List[dict], int]:
    manifest = json.loads((CONTRACTS / "manifest.json").read_text(encoding="utf-8"))
    texts = {path.stem: norm(path.read_text(encoding="utf-8")) for path in CONTRACTS.glob("0*.md")}

    descriptive: List[dict] = []
    absent: List[dict] = []
    total = 0

    for contract in manifest["contracts"]:
        stem = contract["contract_file"].split("/")[-1].replace(".md", "")
        text = texts.get(stem)
        if text is None:
            continue
        for name, value in (contract.get("evaluation_anchors") or {}).items():
            total += 1
            entry = {"contract": stem, "anchor": name, "value": value}
            if any(v in text for v in variants(str(value))):
                continue
            (descriptive if is_descriptive(str(value)) else absent).append(entry)

    return descriptive, absent, total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--strict", action="store_true", help="exit non-zero when any anchor is unusable")
    args = parser.parse_args()

    descriptive, absent, total = audit()
    usable = total - len(descriptive) - len(absent)

    print(f"anchors: {total} total, {usable} usable\n")

    if descriptive:
        print("DESCRIPTIVE — prose, not a quotable value; cannot be matched by substring:")
        for entry in descriptive:
            print(f"  {entry['contract'][:26]:<28}{entry['anchor']:<32}{entry['value']!r}")
        print()

    if absent:
        print("ABSENT — the value does not appear in its own contract; the anchor is wrong:")
        for entry in absent:
            print(f"  {entry['contract'][:26]:<28}{entry['anchor']:<32}{entry['value']!r}")
        print()

    if not descriptive and not absent:
        print("Every anchor is present in its contract.")

    return 1 if args.strict and (descriptive or absent) else 0


if __name__ == "__main__":
    raise SystemExit(main())
