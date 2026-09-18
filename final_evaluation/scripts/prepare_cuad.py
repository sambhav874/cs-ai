#!/usr/bin/env python3
"""Prepare a CUAD manifest for the final ContractSense evaluation.

The script supports the common SQuAD-style CUAD JSON export. It can use source
PDFs when they are available, or render the CUAD contract text into deterministic
simple PDFs so the end-agent runner can still exercise the product upload path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
import sys
import textwrap
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from final_evaluation.scripts.github_fetch import fetch_cuad_from_github


DEFAULT_CLAUSE_FAMILIES = {
    "document name",
    "parties",
    "agreement date",
    "effective date",
    "expiration date",
    "renewal term",
    "notice period to terminate renewal",
    "governing law",
    "most favored nation",
    "non-compete",
    "exclusivity",
    "no-solicit of customers",
    "competitive restriction exception",
    "non-disparagement",
    "termination for convenience",
    "right of first refusal",
    "change of control",
    "anti-assignment",
    "revenue/profit sharing",
    "price restrictions",
    "minimum commitment",
    "volume restriction",
    "ip ownership assignment",
    "joint ip ownership",
    "license grant",
    "non-transferable license",
    "affiliate license",
    "source code escrow",
    "post-termination services",
    "audit rights",
    "uncapped liability",
    "cap on liability",
    "liquidated damages",
    "warranty duration",
    "insurance",
    "covenant not to sue",
    "third party beneficiary",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare CUAD manifest for ContractSense final evaluation.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--cuad-json", type=Path, help="Path to CUAD SQuAD-style JSON.")
    source.add_argument("--fetch-github", action="store_true", help="Download TheAtticusProject/cuad data.zip from GitHub.")
    parser.add_argument("--pdf-root", type=Path, help="Optional root containing original CUAD PDFs.")
    parser.add_argument("--download-dir", type=Path, default=Path("final_evaluation/datasets/raw"))
    parser.add_argument("--force-download", action="store_true", help="Redownload and re-extract the GitHub zip.")
    parser.add_argument("--output", type=Path, default=Path("final_evaluation/datasets/cuad_manifest.jsonl"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("final_evaluation/datasets/generated_pdfs"))
    parser.add_argument("--contract-count", type=int, default=10, choices=[10, 25, 50, 100])
    parser.add_argument("--seed", type=int, default=874)
    parser.add_argument("--no-render-pdfs", action="store_true", help="Require source PDFs instead of rendering text PDFs.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cuad_json = args.cuad_json
    pdf_root = args.pdf_root
    if args.fetch_github:
        cuad_json, extracted_root = fetch_cuad_from_github(args.download_dir, force=args.force_download)
        if not pdf_root:
            pdf_root = extracted_root
        print(f"Fetched CUAD from GitHub: {cuad_json}")

    if not cuad_json:
        raise SystemExit("Missing CUAD JSON. Use --cuad-json or --fetch-github.")

    records = load_cuad_records(cuad_json)
    if not records:
        raise SystemExit("No CUAD records were found.")

    for record in records:
        record["source_pdf_path"] = find_pdf_for_title(pdf_root, record["title"]) if pdf_root else None
        if not record["source_pdf_path"] and not args.no_render_pdfs:
            args.artifacts_dir.mkdir(parents=True, exist_ok=True)
            pdf_path = args.artifacts_dir / f"{record['contract_id']}.pdf"
            write_text_pdf(pdf_path, record["title"], record["text"])
            record["source_pdf_path"] = str(pdf_path)
            record["transport"] = "rendered_text_pdf"
        elif record["source_pdf_path"]:
            record["transport"] = "source_pdf"
        else:
            record["transport"] = "missing_pdf"

    selected = stratified_sample(records, args.contract_count, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for record in selected:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"Wrote {len(selected)} CUAD contracts to {args.output}")
    return 0


def load_cuad_records(path: Path) -> List[Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    records: List[Dict[str, Any]] = []
    data = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(data, list):
        raise ValueError("CUAD JSON must contain a top-level data list or be a list.")

    all_clause_types = set(DEFAULT_CLAUSE_FAMILIES)
    raw_records: List[Dict[str, Any]] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("contract_name") or f"contract_{index + 1}")
        paragraphs = item.get("paragraphs") if isinstance(item.get("paragraphs"), list) else []
        if not paragraphs and item.get("context"):
            paragraphs = [{"context": item.get("context"), "qas": item.get("qas", [])}]
        text_parts: List[str] = []
        labels_by_clause: Dict[str, Dict[str, Any]] = {}
        running_offset = 0
        for paragraph in paragraphs:
            context = str(paragraph.get("context") or "")
            if not context.strip():
                continue
            text_parts.append(context)
            for qa in paragraph.get("qas", []) or []:
                question = str(qa.get("question") or qa.get("clause_type") or "").strip()
                clause_type = normalize_clause_type(question)
                if not clause_type:
                    continue
                all_clause_types.add(clause_type)
                answers = []
                for answer in qa.get("answers", []) or []:
                    text = str(answer.get("text") or "").strip()
                    if not text:
                        continue
                    start = answer.get("answer_start")
                    if isinstance(start, int):
                        start = running_offset + start
                        end = start + len(text)
                    else:
                        start, end = None, None
                    answers.append({"text": text, "start": start, "end": end})
                existing = labels_by_clause.setdefault(
                    clause_type,
                    {"clause_type": clause_type, "question": question, "present": False, "spans": []},
                )
                if answers:
                    existing["present"] = True
                    existing["spans"].extend(answers)
            running_offset += len(context) + 1

        full_text = "\n".join(text_parts).strip()
        if not full_text:
            continue
        contract_id = stable_contract_id(title, index)
        raw_records.append(
            {
                "contract_id": contract_id,
                "title": title,
                "text": full_text,
                "labels": list(labels_by_clause.values()),
                "stats": {
                    "char_count": len(full_text),
                    "annotation_count": sum(len(label["spans"]) for label in labels_by_clause.values()),
                    "clause_type_count": sum(1 for label in labels_by_clause.values() if label.get("present")),
                },
                "source": {
                    "dataset": "CUAD",
                    "license": "CC BY 4.0",
                    "raw_json": str(path),
                },
            }
        )

    for record in raw_records:
        present = {label["clause_type"] for label in record["labels"] if label.get("present")}
        absent = sorted(all_clause_types - present)
        record["absent_clause_types"] = absent
        record["sampling"] = sampling_features(record)
        records.append(record)
    return records


def normalize_clause_type(question: str) -> str:
    text = re.sub(r"\s+", " ", question or "").strip().lower()
    text = re.sub(r"^highlight the parts .*? (?:that|which) (?:say|mention|describe) ", "", text)
    text = re.sub(r"^highlight the parts .*? related to ", "", text)
    text = text.strip(" ?.:-")
    return text[:160]


def stable_contract_id(title: str, index: int) -> str:
    digest = hashlib.sha1(f"{index}:{title}".encode("utf-8")).hexdigest()[:12]
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or f"contract-{index + 1}"
    return f"cuad-{index + 1:04d}-{slug}-{digest}"


def sampling_features(record: Dict[str, Any]) -> Dict[str, Any]:
    chars = int(record["stats"]["char_count"])
    annotations = int(record["stats"]["annotation_count"])
    diversity = int(record["stats"]["clause_type_count"])
    if chars < 35_000:
        length_bucket = "short"
    elif chars < 90_000:
        length_bucket = "medium"
    else:
        length_bucket = "long"
    density = annotations / max(chars / 10_000, 1)
    if density < 2:
        density_bucket = "sparse"
    elif density < 8:
        density_bucket = "normal"
    else:
        density_bucket = "dense"
    diversity_bucket = "diverse" if diversity >= 8 else "focused"
    return {
        "length_bucket": length_bucket,
        "density_bucket": density_bucket,
        "diversity_bucket": diversity_bucket,
        "density_per_10k_chars": round(density, 3),
    }


def stratified_sample(records: List[Dict[str, Any]], count: int, seed: int) -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for record in records:
        features = record["sampling"]
        key = "|".join([features["length_bucket"], features["density_bucket"], features["diversity_bucket"]])
        buckets.setdefault(key, []).append(record)
    for rows in buckets.values():
        rows.sort(key=lambda row: (-row["stats"]["annotation_count"], row["title"]))
        rng.shuffle(rows)

    selected: List[Dict[str, Any]] = []
    bucket_keys = sorted(buckets)
    while len(selected) < count and bucket_keys:
        progressed = False
        for key in bucket_keys:
            rows = buckets[key]
            if rows:
                selected.append(rows.pop(0))
                progressed = True
                if len(selected) >= count:
                    break
        if not progressed:
            break
    selected.sort(key=lambda row: row["contract_id"])
    for split_index, record in enumerate(selected):
        record["split"] = "holdout" if split_index >= math.ceil(len(selected) * 0.8) else "evaluation"
        record["sampling"]["seed"] = seed
        record["sampling"]["requested_contract_count"] = count
    return selected


def find_pdf_for_title(root: Optional[Path], title: str) -> Optional[str]:
    if not root or not root.exists():
        return None
    normalized_title = normalize_file_stem(title)
    candidates = list(root.rglob("*.pdf"))
    for candidate in candidates:
        if normalize_file_stem(candidate.stem) == normalized_title:
            return str(candidate)
    for candidate in candidates:
        if normalized_title in normalize_file_stem(candidate.stem) or normalize_file_stem(candidate.stem) in normalized_title:
            return str(candidate)
    return None


def normalize_file_stem(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def write_text_pdf(path: Path, title: str, text: str) -> None:
    lines = [title, "", *wrap_pdf_lines(text)]
    pages = [lines[index : index + 70] for index in range(0, len(lines), 70)] or [[title]]
    objects: List[bytes] = []

    def add_object(content: bytes) -> int:
        objects.append(content)
        return len(objects)

    font_id = add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: List[int] = []
    content_ids: List[int] = []
    for page_lines in pages:
        stream = build_pdf_text_stream(page_lines)
        content_id = add_object(
            b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream"
        )
        content_ids.append(content_id)
        page_id = add_object(b"")
        page_ids.append(page_id)

    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids).encode("ascii")
    pages_id = add_object(b"<< /Type /Pages /Count " + str(len(page_ids)).encode("ascii") + b" /Kids [ " + kids + b" ] >>")
    catalog_id = add_object(b"<< /Type /Catalog /Pages " + str(pages_id).encode("ascii") + b" 0 R >>")

    for page_id, content_id in zip(page_ids, content_ids):
        objects[page_id - 1] = (
            b"<< /Type /Page /Parent "
            + str(pages_id).encode("ascii")
            + b" 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 "
            + str(font_id).encode("ascii")
            + b" 0 R >> >> /Contents "
            + str(content_id).encode("ascii")
            + b" 0 R >>"
        )

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, content in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(content)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        b"trailer\n<< /Size "
        + str(len(objects) + 1).encode("ascii")
        + b" /Root "
        + str(catalog_id).encode("ascii")
        + b" 0 R >>\nstartxref\n"
        + str(xref_offset).encode("ascii")
        + b"\n%%EOF\n"
    )
    path.write_bytes(bytes(output))


def wrap_pdf_lines(text: str) -> List[str]:
    clean = re.sub(r"\s+", " ", text or "").strip()
    lines: List[str] = []
    for paragraph in re.split(r"(?<=\.)\s+", clean):
        lines.extend(textwrap.wrap(paragraph, width=95) or [""])
    return lines


def build_pdf_text_stream(lines: Iterable[str]) -> bytes:
    stream_lines = ["BT", "/F1 9 Tf", "50 750 Td", "12 TL"]
    for line in lines:
        stream_lines.append(f"({escape_pdf_text(line)}) Tj")
        stream_lines.append("T*")
    stream_lines.append("ET")
    return "\n".join(stream_lines).encode("latin-1", errors="replace")


def escape_pdf_text(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


if __name__ == "__main__":
    raise SystemExit(main())
