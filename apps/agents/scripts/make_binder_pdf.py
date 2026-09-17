"""
Generate a "binder" fixture PDF: three distinct agreements
(NDA + MSA + SOW) concatenated in one file.

The binder detector's LLM prompt looks for multiple agreement titles +
signature blocks + numbering resets. This fixture supplies all three.

Usage:
    python -m scripts.make_binder_pdf <out.pdf>
"""
from __future__ import annotations

import sys
from pathlib import Path

import fitz


AGREEMENTS = [
    {
        "title": "MUTUAL NON-DISCLOSURE AGREEMENT",
        "counterparty": "Globex Industries, LLC",
        "lines": [
            "This Agreement is entered between Demo Org, Inc. and Globex Industries.",
            "",
            "Section 1. CONFIDENTIALITY.",
            "Each party will protect the other's confidential information.",
            "",
            "Section 2. TERM.",
            "This Agreement terminates two (2) years from the Effective Date.",
            "",
            "Section 3. GOVERNING LAW.",
            "Governed by the laws of Delaware.",
            "",
            "IN WITNESS WHEREOF, the parties have executed this Agreement.",
            "",
            "Demo Org, Inc.              Globex Industries, LLC",
            "______________              ______________",
        ],
    },
    {
        "title": "MASTER SERVICES AGREEMENT",
        "counterparty": "Acme Corporation",
        "lines": [
            "This Agreement is entered between Demo Org, Inc. and Acme Corporation.",
            "",
            "Section 1. SCOPE OF SERVICES.",
            "Provider shall deliver services described in each Statement of Work.",
            "",
            "Section 9. LIMITATION OF LIABILITY.",
            "Each party's liability is capped at twelve (12) months of fees.",
            "Neither party is liable for consequential damages.",
            "",
            "Section 12. GOVERNING LAW.",
            "Governed by the laws of Delaware.",
            "",
            "IN WITNESS WHEREOF, the parties have executed this Agreement.",
            "",
            "Demo Org, Inc.              Acme Corporation",
            "______________              ______________",
        ],
    },
    {
        "title": "STATEMENT OF WORK NO. 1",
        "counterparty": "Acme Corporation",
        "lines": [
            "This Statement of Work is entered under the MSA between Demo Org and Acme.",
            "",
            "Section 1. DELIVERABLES.",
            "Provider shall deliver Phase 1 architecture design by Q2 2026.",
            "",
            "Section 2. FEES.",
            "Total fees: $250,000 payable in monthly installments of $50,000.",
            "",
            "Section 3. TERM.",
            "This SOW ends upon completion of Phase 1.",
            "",
            "IN WITNESS WHEREOF, the parties have executed this Statement of Work.",
            "",
            "Demo Org, Inc.              Acme Corporation",
            "______________              ______________",
        ],
    },
]


def _write_agreement(doc: fitz.Document, agreement: dict) -> None:
    page = doc.new_page(width=612, height=792)
    y = 72
    page.insert_text((72, y), agreement["title"], fontsize=18, fontname="Times-Roman"); y += 50
    for line in agreement["lines"]:
        if line.startswith("Section "):
            size = 11
            font = "Times-Bold"
            gap = 20
        elif line.startswith("IN WITNESS"):
            size = 10
            font = "Times-Roman"
            gap = 30
        elif not line.strip():
            y += 12
            continue
        else:
            size = 10
            font = "Times-Roman"
            gap = 16
        page.insert_text((72, y), line, fontsize=size, fontname=font)
        y += gap


def render(out_path: Path) -> None:
    doc = fitz.open()
    for ag in AGREEMENTS:
        _write_agreement(doc, ag)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))
    doc.close()
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes) — {len(AGREEMENTS)} agreements")


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("binder.pdf")
    render(out)
