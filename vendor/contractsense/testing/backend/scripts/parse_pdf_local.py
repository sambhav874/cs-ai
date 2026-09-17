"""Inspect LiteParse markdown output without Celery or database dependencies."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

APP_BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "backend"
sys.path.insert(0, str(APP_BACKEND_ROOT))

from worker.tasks import _process_with_liteparse


def main() -> int:
    """Parse one PDF locally and print the extracted markdown and quality metadata."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--show-markers", action="store_true")
    parser.add_argument("--quality", action="store_true")
    args = parser.parse_args()

    result = _process_with_liteparse(args.pdf, args.pdf.name, "local-inspection")
    markdown = result.get("markdown", "")
    if args.show_markers:
        print(markdown)
    else:
        print(markdown.replace("<!--TABLE:START", "[TABLE:START").replace("<!--TABLE:END", "[TABLE:END"))
    if args.quality:
        print(
            json.dumps(
                {
                    "page_count": result.get("page_count"),
                    "table_count": result.get("table_count", 0),
                    "table_row_count": result.get("table_row_count", 0),
                    "tables": result.get("tables", []),
                    "parse_quality_score": result.get("parse_quality_score"),
                    "parse_quality_signals": result.get("parse_quality_signals", {}),
                },
                indent=2,
                sort_keys=True,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["main"]
