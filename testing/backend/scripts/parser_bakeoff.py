#!/usr/bin/env python3
"""Parser bake-off: score each PDF parser against the 8 family fixtures.

Every fixture PDF was rendered from a markdown source that sits beside it, so
the source is the ground truth and no hand labels are needed. Per parser and
per fixture this measures:

- text recall        share of source words recovered (multiset, order-free)
- clause recall      share of source headings found as a line in the output
- clause as heading  share of source headings the parser marked as a heading
- table row recall   share of source table rows recovered as a table row with
                     every cell intact
- span coverage      share of source quantitative spans (amounts, rates,
                     durations, deadlines) present verbatim in the output --
                     an upper bound on what the obligation extractor can find
- latency            wall-clock seconds per document and per page
- cost               USD per page (0 for local parsers)

``text_layer`` (the PDF's embedded text via PyMuPDF) is a reference row: it
scores the fixture, so a gap it shares with a parser is the fixture's, not the
parser's. Only LiteParse is a candidate today. Marker and Mistral OCR register here when they are
scored; a parser that is not selected is reported as not run, never as zero.

Usage::

    python testing/backend/scripts/parser_bakeoff.py \\
        --parsers liteparse --out docs/parser-bakeoff/results.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Dict, List, Sequence, Tuple

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps" / "intelligence"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from score_obligation_coverage import _norm, sweep_spans  # noqa: E402

FIXTURES = REPO / "final_evaluation" / "datasets" / "kpi_contracts"

# PDF -> the markdown it was rendered from.
FAMILY_FIXTURES: Dict[str, str] = {
    "full_eval_global_logistics.pdf": "01_global_logistics_master_services_agreement.md",
    "full_eval_healthcare_cloud.pdf": "02_healthcare_cloud_data_processing_agreement.md",
    "full_eval_solar_storage_epc.pdf": "03_solar_storage_epc_and_operations_contract.md",
    "full_eval_payment_processing.pdf": "04_payment_processing_platform_agreement.md",
    "full_eval_smart_transit.pdf": "05_smart_transit_operations_concession.md",
    "full_eval_telecom_5g.pdf": "06_telecom_5g_network_managed_services_agreement.md",
    "full_eval_pharma_cdmo.pdf": "07_pharmaceutical_contract_development_manufacturing_agreement.md",
    "full_eval_enterprise_ai.pdf": "08_enterprise_ai_cloud_infrastructure_master_agreement.md",
}


def _run_liteparse(pdf: Path) -> Dict[str, Any]:
    from worker.tasks import _process_with_liteparse

    result = _process_with_liteparse(pdf, pdf.name, "bakeoff")
    return {"markdown": result["markdown"], "page_count": result.get("page_count") or 0, "cost_usd": 0.0}


def _run_text_layer(pdf: Path) -> Dict[str, Any]:
    """Reference, not a candidate: the PDF's embedded text, no layout.

    Scores the fixture rather than a parser -- anything this misses is absent
    from the PDF, so no parser can be blamed for missing it.
    """
    import fitz

    doc = fitz.open(pdf)
    return {"markdown": "\n".join(page.get_text() for page in doc), "page_count": doc.page_count, "cost_usd": 0.0}


PARSERS: Dict[str, Callable[[Path], Dict[str, Any]]] = {
    "liteparse": _run_liteparse,
    "text_layer": _run_text_layer,
}

_PAGE_MARKER = re.compile(r"^--- Page \d+ ---$", re.M)
_SENTINEL = re.compile(r"<!--TABLE:(?:START|END)[^>]*-->")
_DELIMITER = re.compile(r"^\|[\s:|\-]+\|$")


def _words(text: str) -> Counter:
    return Counter(re.findall(r"[a-z0-9]+(?:[.,][0-9]+)*", _norm(text)))


def _strip_markup(markdown: str) -> str:
    text = _SENTINEL.sub("", _PAGE_MARKER.sub("", markdown))
    return re.sub(r"^#+\s*", "", text, flags=re.M)


def _headings(markdown: str) -> List[str]:
    return [_norm(m.group(1)) for m in re.finditer(r"^#{1,6}\s+(.+?)\s*$", markdown, re.M)]


def _line_set(markdown: str) -> set[str]:
    lines = set()
    for raw in _strip_markup(markdown).splitlines():
        line = _norm(raw.strip("|").strip())
        if line:
            lines.add(line)
    return lines


def _table_rows(markdown: str) -> List[Tuple[str, ...]]:
    rows = []
    for raw in markdown.splitlines():
        line = raw.strip()
        if line.startswith("|") and line.endswith("|") and not _DELIMITER.match(line):
            rows.append(tuple(_norm(c) for c in line.strip("|").split("|")))
    return rows


def _ratio(hit: int, total: int) -> float | None:
    return round(hit / total, 4) if total else None


def score(source: str, parsed: str) -> Dict[str, Any]:
    src_words, out_words = _words(_strip_markup(source)), _words(_strip_markup(parsed))
    word_hit = sum(min(n, out_words[w]) for w, n in src_words.items())

    src_heads = _headings(source)
    out_lines, out_heads = _line_set(parsed), set(_headings(parsed))
    # Found anywhere in the running text: a long heading the PDF wrapped onto
    # two lines is still recovered text. Whether it came back AS a heading is
    # clause_as_heading's job.
    flat_joined = _norm(" ".join(out_lines))
    head_found = sum(1 for h in src_heads if h in flat_joined)
    head_marked = sum(1 for h in src_heads if h in out_heads)

    src_rows = _table_rows(source)
    out_rows = Counter(_table_rows(parsed))
    row_hit = 0
    for row in src_rows:
        if out_rows[row]:
            out_rows[row] -= 1
            row_hit += 1

    spans = sweep_spans(source)
    flat = _norm(_strip_markup(parsed))
    missed = [s["text"] for s in spans if _norm(s["text"]) not in flat]

    return {
        "text_recall": _ratio(word_hit, sum(src_words.values())),
        "clause_recall": _ratio(head_found, len(src_heads)),
        "clause_as_heading": _ratio(head_marked, len(src_heads)),
        "table_row_recall": _ratio(row_hit, len(src_rows)),
        "span_coverage": _ratio(len(spans) - len(missed), len(spans)),
        "counts": {
            "source_words": sum(src_words.values()),
            "source_headings": len(src_heads),
            "source_table_rows": len(src_rows),
            "source_spans": len(spans),
        },
        "missed_spans": missed[:20],
    }


def run(parsers: Sequence[str], dump_dir: Path | None) -> Dict[str, Any]:
    results: Dict[str, Any] = {}
    for name in parsers:
        per_doc = {}
        # Untimed warm-up: the first call pays for imports and model loads,
        # which would otherwise land on whichever fixture happens to run first.
        try:
            PARSERS[name](FIXTURES / next(iter(FAMILY_FIXTURES)))
        except Exception:
            pass
        for pdf_name, md_name in FAMILY_FIXTURES.items():
            pdf, source = FIXTURES / pdf_name, (FIXTURES / md_name).read_text()
            started = time.perf_counter()
            try:
                out = PARSERS[name](pdf)
            except Exception as exc:  # a parser failure is a result, not a crash
                per_doc[pdf_name] = {"error": f"{type(exc).__name__}: {exc}"}
                continue
            seconds = time.perf_counter() - started
            pages = out["page_count"] or 1
            if dump_dir:
                dump_dir.mkdir(parents=True, exist_ok=True)
                (dump_dir / f"{name}__{pdf.stem}.md").write_text(out["markdown"])
            per_doc[pdf_name] = {
                **score(source, out["markdown"]),
                "pages": out["page_count"],
                "seconds": round(seconds, 2),
                "seconds_per_page": round(seconds / pages, 3),
                "cost_usd_per_page": round(out["cost_usd"] / pages, 5),
            }
            print(f"{name:10} {pdf_name:36} {json.dumps({k: v for k, v in per_doc[pdf_name].items() if k not in ('counts', 'missed_spans')})}")
        results[name] = {"documents": per_doc, "summary": _summary(per_doc)}
    return results


def _summary(per_doc: Dict[str, Any]) -> Dict[str, Any]:
    ok = [d for d in per_doc.values() if "error" not in d]
    out: Dict[str, Any] = {"documents_ok": len(ok), "documents_failed": len(per_doc) - len(ok)}
    for key in ("text_recall", "clause_recall", "clause_as_heading", "table_row_recall", "span_coverage", "seconds_per_page"):
        values = [d[key] for d in ok if d.get(key) is not None]
        out[f"mean_{key}"] = round(sum(values) / len(values), 4) if values else None
    return out


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parsers", nargs="+", default=["text_layer", "liteparse"], choices=sorted(PARSERS))
    ap.add_argument("--out", type=Path, help="write the full results as JSON")
    ap.add_argument("--dump", type=Path, help="write each parser's markdown here for inspection")
    args = ap.parse_args(argv)

    results = run(args.parsers, args.dump)
    for name, res in results.items():
        print(f"\n{name}: {json.dumps(res['summary'])}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
