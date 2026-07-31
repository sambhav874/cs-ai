"""Small GitHub download helpers for final evaluation data prep."""

from __future__ import annotations

import shutil
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional


CUAD_DATA_ZIP_URL = "https://github.com/TheAtticusProject/cuad/raw/main/data.zip"
ACORD_DATA_ZIP_URL = "https://github.com/TheAtticusProject/acord/raw/main/ACORD%20Dataset%20%26%20ReadMe.zip"


def download_zip(url: str, destination: Path, *, force: bool = False) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0 and not force:
        return destination
    request = urllib.request.Request(url, headers={"User-Agent": "ContractSenseFinalEvaluation/1.0"})
    with urllib.request.urlopen(request, timeout=600) as response, destination.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    return destination


def extract_zip(zip_path: Path, destination: Path, *, force: bool = False) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    marker = destination / ".extract_complete"
    if marker.exists() and not force:
        return destination
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(destination)
    marker.write_text(str(zip_path), encoding="utf-8")
    return destination


def find_first(root: Path, *patterns: str) -> Optional[Path]:
    for pattern in patterns:
        matches = sorted(path for path in root.rglob(pattern) if path.is_file())
        if matches:
            return matches[0]
    return None


def fetch_cuad_from_github(download_dir: Path, *, force: bool = False) -> tuple[Path, Path]:
    zip_path = download_zip(CUAD_DATA_ZIP_URL, download_dir / "cuad" / "data.zip", force=force)
    extract_root = extract_zip(zip_path, download_dir / "cuad" / "extracted", force=force)
    json_path = find_first(
        extract_root,
        "CUAD_v1.json",
        "CUADv1.json",
        "*CUAD*.json",
        "*.json",
    )
    if not json_path:
        raise FileNotFoundError(f"Could not find CUAD JSON inside {extract_root}")
    return json_path, extract_root


def fetch_acord_from_github(download_dir: Path, *, force: bool = False) -> Path:
    zip_path = download_zip(
        ACORD_DATA_ZIP_URL,
        download_dir / "acord" / "ACORD Dataset & ReadMe.zip",
        force=force,
    )
    return extract_zip(zip_path, download_dir / "acord" / "extracted", force=force)
