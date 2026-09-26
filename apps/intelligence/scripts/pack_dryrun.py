#!/usr/bin/env python3
"""Try a pack against a contract without calling a model or touching a database.

Answers the three questions you actually have about a pack: is it valid, would it
be picked for this contract, and what exactly does the model get shown?

    # a pack directory or an uploaded .zip
    python3 apps/backend/scripts/pack_dryrun.py --pack packs/logistics
    python3 apps/backend/scripts/pack_dryrun.py --pack /tmp/widget_msa.zip

    # add a contract to see whether it would actually be selected
    python3 apps/backend/scripts/pack_dryrun.py --pack <pack> \
        --contract final_evaluation/datasets/kpi_contracts/01_global_logistics_master_services_agreement.md

    # what happens to every fixture, with the built-in packs
    python3 apps/backend/scripts/pack_dryrun.py --corpus final_evaluation/datasets/kpi_contracts
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

APP_BACKEND = Path(__file__).resolve().parents[1]
if str(APP_BACKEND) not in sys.path:
    sys.path.insert(0, str(APP_BACKEND))

import yaml  # noqa: E402

from services.obligation_packs import (  # noqa: E402
    MAX_COVERAGE_CHARS,
    MAX_MANIFEST_CHARS,
    PackContent,
    PackError,
    SECTION_ORDER,
    build_pack,
    builtin_packs,
    estimate_tokens,
    load_base_sections,
    render_pack_block,
    resolve_family,
    validate_pack_content,
)


def read_pack(path: Path) -> tuple[str, PackContent]:
    """Load pack content from a directory or a .zip, the same way an upload does."""
    if path.suffix == ".zip":
        from services.obligation_pack_store import parse_pack_archive

        content, problems = parse_pack_archive(path.read_bytes())
        if problems:
            print("ARCHIVE PROBLEMS")
            for problem in problems:
                print(f"  - {problem}")
            raise SystemExit(1)
        return str(content.manifest.get("id") or path.stem), content

    manifest_path = path / "pack.yaml"
    manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    coverage_path = path / "coverage.yaml"
    coverage = yaml.safe_load(coverage_path.read_text(encoding="utf-8")) if coverage_path.is_file() else {}
    sections = {
        section: (path / f"{section}.md").read_text(encoding="utf-8").strip()
        for section in SECTION_ORDER
        if (path / f"{section}.md").is_file()
    }
    return str((manifest or {}).get("id") or path.name), PackContent(
        manifest=manifest or {}, sections=sections, coverage=coverage or {}
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pack", type=Path, help="pack directory or .zip")
    parser.add_argument("--contract", type=Path, help="a contract file to resolve against")
    parser.add_argument("--corpus", type=Path, help="a directory of contracts; report resolution for each")
    parser.add_argument("--show-block", action="store_true", help="print the rendered block in full")
    args = parser.parse_args()

    candidate = None

    if args.pack:
        family_id, content = read_pack(args.pack)
        print(f"pack         : {family_id}  ({args.pack})")

        problems = validate_pack_content(family_id, content)
        if problems:
            print(f"\nREJECTED — {len(problems)} problem(s):")
            for problem in problems:
                print(f"  - {problem}")
            return 1

        try:
            candidate = build_pack(family_id, content, base_sections=load_base_sections(), origin="dryrun")
        except PackError as exc:
            print(f"\nREJECTED\n{exc}")
            return 1

        block = render_pack_block(candidate)
        tokens = estimate_tokens(block)
        print(f"valid        : yes")
        print(f"sections     : {', '.join(s for s in SECTION_ORDER if candidate.sections.get(s))}")
        print(f"context cost : {tokens} tokens / {candidate.max_context_tokens} budget")
        dropped = [
            section
            for section in SECTION_ORDER
            if candidate.sections.get(section) and f"## {_title(section)}" not in block
        ]
        if dropped:
            print(f"dropped      : {', '.join(dropped)}  (over budget)")
        if "…[truncated]" in block:
            print("truncated    : YES — a section was cut to fit")
        if args.show_block:
            print("\n" + "─" * 78)
            print(block)
            print("─" * 78)

    packs = ([candidate] if candidate else []) + builtin_packs()

    if args.contract:
        _report(args.contract, packs)

    if args.corpus:
        print(f"\nresolution across {args.corpus}:")
        for path in sorted(args.corpus.glob("*.md")):
            _report(path, packs, indent="  ")

    if not (args.pack or args.contract or args.corpus):
        parser.print_help()
        return 1
    return 0


def _title(section: str) -> str:
    from services.obligation_packs import _SECTION_TITLES

    return _SECTION_TITLES.get(section, section)


def _report(path: Path, packs, indent: str = "") -> None:
    body = path.read_text(encoding="utf-8")
    # Production passes the contract's stored name, which is normally derived
    # from the filename — not the document's first line. Scoring the first line
    # here made every title pattern miss on files that open with a date stamp.
    heading = body.splitlines()[0].lstrip("# ").strip() if body else ""
    title = f"{path.stem} {heading}"
    resolution = resolve_family(title=title, body=body, packs=packs)
    chosen = resolution.pack.id if resolution.pack else "none"
    mark = "APPLIED" if resolution.applied else "base only"
    print(f"{indent}{path.name[:44]:46} {chosen:16} {resolution.confidence:.2f}  {mark}")
    if resolution.applied:
        print(f"{indent}    signals: {', '.join(resolution.signals[:6]) or 'none'}")
    else:
        print(f"{indent}    {resolution.reason}")


if __name__ == "__main__":
    raise SystemExit(main())
