"""
Generate a "scanned" PDF fixture with a known text body.

A scanned PDF has no embedded text layer — just page images. We fake
one by rendering text to a PIL image, then saving that image as a PDF.
The resulting file is indistinguishable from a real scan for the
purpose of exercising the OCR path in /extract.

Usage:
    python -m scripts.make_scanned_pdf <out.pdf>
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


TITLE = "MASTER SERVICES AGREEMENT (SCANNED FIXTURE)"
BODY_LINES = [
    "This Agreement is entered into between Demo Org, Inc. and Acme Corporation.",
    "",
    "Section 1. SCOPE OF SERVICES.",
    "Provider shall deliver the services described in each Statement of Work.",
    "",
    "Section 9.2. LIMITATION OF LIABILITY.",
    "Each party's total aggregate liability arising out of or relating to",
    "this Agreement shall not exceed the fees paid in the preceding twelve",
    "(12) months. Neither party shall be liable for consequential damages.",
    "",
    "Section 12. GOVERNING LAW.",
    "This Agreement is governed by the laws of the State of Delaware.",
    "",
    "Signed: Demo Org, Inc.          Signed: Acme Corporation",
]

# Tokens the verify will assert are present in the OCR output.
REQUIRED_TOKENS = [
    "MASTER SERVICES AGREEMENT",
    "Demo Org",
    "Acme Corporation",
    "LIMITATION OF LIABILITY",
    "twelve",
    "Delaware",
]


def render(out_path: Path) -> None:
    """Render BODY_LINES onto an 8.5 x 11 @ 150 DPI image → save as PDF."""
    W, H = int(8.5 * 150), int(11 * 150)  # letter @ 150 dpi
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    # Pick a font — try a few common system paths; fall back to default
    # (which is small but readable by OCR).
    font_title = None
    font_body = None
    for path in (
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        "/Library/Fonts/Arial.ttf",
    ):
        try:
            font_title = ImageFont.truetype(path, 36)
            font_body = ImageFont.truetype(path, 22)
            break
        except OSError:
            continue
    if font_title is None:
        font_title = ImageFont.load_default()
        font_body = ImageFont.load_default()

    draw.text((120, 120), TITLE, fill="black", font=font_title)
    y = 220
    for line in BODY_LINES:
        draw.text((120, y), line, fill="black", font=font_body)
        y += 36

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PDF", resolution=150.0)
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("scanned.pdf")
    render(out)
