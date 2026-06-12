from __future__ import annotations

import re
from urllib.parse import quote


def safe_download_filename(value: str | None, fallback: str) -> str:
    name = (value or fallback).strip() or fallback
    name = re.sub(r"[\r\n\\/]+", "_", name)
    name = re.sub(r"[\x00-\x1f\x7f]+", "", name)
    return name[:180] or fallback


def content_disposition(disposition: str, filename: str | None, fallback: str) -> str:
    safe_name = safe_download_filename(filename, fallback)
    ascii_name = safe_name.encode("ascii", "ignore").decode("ascii") or fallback
    ascii_name = ascii_name.replace('"', "")
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe_name)}"
