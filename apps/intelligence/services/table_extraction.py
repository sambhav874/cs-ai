"""Read-side access to the table sentinels embedded in parsed contract markdown.

Sentinels are written once, at parse time, by the ingestion worker. This module
reads them back out of a stored ``index.content`` so a contract's tables can be
inspected without re-parsing the source PDF and without storing the table bodies
a second time.

The diagnostics returned alongside each table are deliberately blunt counts
rather than a classifier. Their job is to make a malformed or multi-part table
*visible* to a person reading the preview, not to decide anything on its own.
"""

import hashlib
import re
from typing import Any, Dict, List, Optional

# Must stay in step with the sentinel written by ``worker.tasks``. That module
# still carries its own copy for the parse path; this is the read path.
TABLE_MARKER_REGEX = re.compile(
    r"<!--TABLE:START(?P<attrs>[^>]*)-->\n(?P<body>.*?)\n<!--TABLE:END[^>]*-->",
    re.DOTALL,
)
PAGE_MARKER_REGEX = re.compile(r"---\s*Page\s+(\d+)\s*---", re.IGNORECASE)
HEADING_REGEX = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$", re.MULTILINE)
SHAPE_ATTR_REGEX = re.compile(r"\b(rows|cols)=(\d+)")


_HTML_TAG = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    """Drop inline markup a parser may leave inside a cell.

    Marker emits ``<b>``, ``<br>`` and ``<a href=...>`` inside table cells.
    Left in place the tags reach the display text and, worse, the signature —
    so the same table would hash differently depending on which parser read it,
    and a schedule would stop matching its own later revision across a parser
    change.
    """
    return _HTML_TAG.sub(" ", text or "").replace("&amp;", "&").strip()


def _cells(line: str) -> List[str]:
    """Split one pipe row into trimmed cell values."""
    return [
        re.sub(r"\s{2,}", " ", _strip_html(cell)).strip()
        for cell in line.strip().strip("|").split("|")
    ]


def _non_empty_lines(body: str) -> List[str]:
    return [line for line in body.splitlines() if line.strip()]


def _clean_heading(text: str) -> str:
    """Strip the markdown emphasis the parser leaves on many contract headings."""
    return re.sub(r"[*_`]+", "", text).strip()


def _section_path_before(content: str, offset: int) -> Optional[str]:
    """Nearest markdown heading preceding an offset, or None above the first one."""
    last: Optional[str] = None
    for match in HEADING_REGEX.finditer(content, 0, offset):
        last = match.group(1)
    return _clean_heading(last) if last else None


def _page_before(content: str, offset: int) -> Optional[int]:
    last: Optional[int] = None
    for match in PAGE_MARKER_REGEX.finditer(content, 0, offset):
        last = int(match.group(1))
    return last


def _diagnostics(body: str) -> Dict[str, Any]:
    """Cheap structural signals that a table may not be a single clean grid.

    ``sparse_rows`` counts data rows where at least half the cells are empty.
    Those are how sub-table separators and section labels show up in practice
    (``| RAMP | SERVICES | | |``), but a genuinely short data row looks the same,
    so this is reported as an observation for a human rather than a verdict.
    """
    lines = _non_empty_lines(body)
    data_rows = lines[2:] if len(lines) >= 2 else []
    blank_rows = 0
    sparse_rows = 0
    for row in data_rows:
        cells = _cells(row)
        filled = [cell for cell in cells if cell]
        if not filled:
            blank_rows += 1
        elif cells and len(filled) * 2 <= len(cells):
            sparse_rows += 1
    return {
        "data_row_count": len(data_rows),
        "blank_rows": blank_rows,
        "sparse_rows": sparse_rows,
        "possible_multi_table": bool(blank_rows or sparse_rows),
    }


def _is_blank_row(cells: List[str]) -> bool:
    return not any(cells)


def _is_banner_row(cells: List[str]) -> bool:
    """A merged title cell that the parser split across the column grid.

    ``| RAMP | SERVICES | | |`` is really one centred cell reading "RAMP
    SERVICES". Sparseness alone cannot prove that — a genuinely short data row
    looks identical — so callers must also require a populated header to follow.
    """
    filled = [cell for cell in cells if cell]
    return bool(filled) and len(filled) * 2 <= len(cells)


def _drop_empty_columns(rows: List[List[str]]) -> List[List[str]]:
    """Remove columns that are empty in every row, header included.

    Fused tables inherit the widest grid on the page, leaving narrow tables
    padded with columns that never carry a value.
    """
    if not rows:
        return rows
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    keep = [i for i in range(width) if any(row[i] for row in padded)]
    if not keep:
        return padded
    return [[row[i] for i in keep] for row in padded]


def _split_fused_table(body: str) -> List[Dict[str, Any]]:
    """Split one physical markdown table into the logical tables it contains.

    liteparse groups tables by column alignment and ignores vertical gaps, so
    several unrelated tables on a page arrive fused into a single grid. At read
    time the cell geometry is gone, leaving two boundary signals that are safe
    on text alone: a wholly blank row, and a row repeating a header already
    seen. A banner row on its own is deliberately *not* a boundary — a wrapped
    header continuation ("| ASSOCIATION HELLAS |  |") is indistinguishable from
    a title, and splitting there drops the real header. Where nothing fires the
    table is returned unchanged.
    """
    lines = [line for line in body.splitlines() if line.strip()]
    if len(lines) < 2:
        return [{"caption": None, "rows": [_cells(line) for line in lines]}]

    header = _cells(lines[0])
    data = [_cells(line) for line in lines[2:]]

    seen_headers = {tuple(header)}
    boundaries = set()
    for index, cells in enumerate(data):
        if _is_blank_row(cells):
            boundaries.add(index)
            continue
        signature = tuple(cells)
        if signature in seen_headers:
            start = index
            # Keep a banner with the table it titles rather than the one above.
            if start and _is_banner_row(data[start - 1]) and not _is_blank_row(data[start - 1]):
                start -= 1
            boundaries.add(start)
        seen_headers.add(signature)

    cuts = sorted({0, len(data)} | boundaries)
    parts: List[Dict[str, Any]] = []
    for start, end in zip(cuts, cuts[1:]):
        group = [cells for cells in data[start:end] if not _is_blank_row(cells)]
        if not group:
            continue
        if not parts:
            caption, part_header, part_rows = None, header, group
            # A parser that keeps merged cells puts the banner title in the
            # header position ("| RAMP SERVICES | | | |") and pushes the real
            # header down a row. Promote only when the row below is fully
            # populated: an entirely empty header means the table genuinely has
            # none, and its first row is data, not a header.
            if _is_banner_row(header) and group and all(group[0]):
                caption = " ".join(cell for cell in header if cell)
                part_header, part_rows = group[0], group[1:]
            else:
                # A wrapped header continuation looks sparse too, so anything
                # that is not a banner keeps the header it came with.
                pass
        else:
            caption = None
            if _is_banner_row(group[0]) and len(group) > 1 and all(group[1]):
                caption = " ".join(cell for cell in group[0] if cell)
                group = group[1:]
            part_header, part_rows = group[0], group[1:]
        parts.append({"caption": caption, "rows": _drop_empty_columns([part_header, *part_rows])})

    return parts or [{"caption": None, "rows": _drop_empty_columns([header, *data])}]


def _normalize_for_key(text: str) -> str:
    """Fold case, spacing and punctuation so cosmetic edits do not change a key."""
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def table_signature(
    header: List[str],
    caption: Optional[str] = None,
    rows: Optional[List[List[str]]] = None,
) -> str:
    """Identity of a table *as a schedule*, across documents and revisions.

    Deliberately built from the caption and header only. When a rate card is
    reissued the values change and the column headings do not, so hashing the
    values would give every revision a different identity — the opposite of
    what matching a 2022 schedule to its 2024 replacement needs.

    Unruled lists often have no header at all. Hashing an empty header would
    give every such table the same identity, so those fall back to their row
    labels, which are the part that stays put while the prices move.
    """
    basis = [_normalize_for_key(caption or "")] + [_normalize_for_key(cell) for cell in header]
    if not any(basis):
        basis += [_normalize_for_key(row[0]) for row in (rows or []) if row]
    return hashlib.sha256("|".join(basis).encode("utf-8")).hexdigest()[:16]


def content_hash(body: str) -> str:
    """Identity of a table's *contents*, for telling a real change from a re-upload."""
    normalized = "\n".join(
        " ".join(_normalize_for_key(cell) for cell in _cells(line))
        for line in body.splitlines()
        if line.strip()
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _render_table(rows: List[List[str]]) -> str:
    """Rebuild markdown for one logical table, header row first."""
    if not rows:
        return ""
    width = len(rows[0])
    body = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    body.extend("| " + " | ".join(row) + " |" for row in rows[1:])
    return "\n".join(body)


def _format_marker(index: int, table: Dict[str, Any], table_type: Optional[str] = None) -> str:
    """Render one table back into a sentinel-wrapped block."""
    attrs = [
        f"id=t{index}",
        f"rows={table['rows']}",
        f"cols={table['cols']}",
        f"sig={table['signature']}",
    ]
    if table.get("caption"):
        attrs.append(f'caption="{table["caption"]}"')
    if table_type:
        attrs.append(f'type="{table_type}"')
    return (
        f"<!--TABLE:START {' '.join(attrs)}-->\n"
        f"{table['body']}\n"
        f"<!--TABLE:END id=t{index}-->"
    )


def normalize_table_markers(
    content: str,
    classifications: Optional[Dict[str, str]] = None,
) -> str:
    """Rewrite a parsed document so each sentinel holds exactly one logical table.

    Parsers that group by column alignment emit several unrelated tables as one
    grid. Splitting once here, immediately after parsing, means the segmenter,
    the preview and the classifier all see the same tables instead of each
    re-deriving them. A document whose tables were already clean passes through
    with only its attributes rewritten.

    ``classifications`` maps a table signature to its label, so a second pass
    after classification can stamp the type into the markup without re-splitting.
    """
    if not content or "<!--TABLE:START" not in content:
        return content

    tables = extract_tables(content)
    if not tables:
        return content

    by_source: Dict[int, List[Dict[str, Any]]] = {}
    for table in tables:
        by_source.setdefault(table["source_ordinal"], []).append(table)

    out: List[str] = []
    cursor = 0
    index = 0
    for source_ordinal, match in enumerate(TABLE_MARKER_REGEX.finditer(content), 1):
        out.append(content[cursor:match.start()])
        # Separate only the parts this sentinel was split into. Counting across
        # sentinels instead would re-insert a blank line ahead of text that
        # already carries one, so re-normalizing would not be a no-op.
        for part_index, table in enumerate(by_source.get(source_ordinal, [])):
            index += 1
            if part_index:
                out.append("\n\n")
            out.append(_format_marker(index, table, (classifications or {}).get(table["signature"])))
        cursor = match.end()
    out.append(content[cursor:])
    return "".join(out)


def extract_tables(content: str) -> List[Dict[str, Any]]:
    """Every logical table in a parsed contract, in document order.

    One sentinel can yield several tables: see ``_split_fused_table``. Returns
    an empty list for contracts parsed before table sentinels existed — absence
    of sentinels is not an error, just an older document.
    """
    if not content:
        return []

    tables: List[Dict[str, Any]] = []
    for source_ordinal, match in enumerate(TABLE_MARKER_REGEX.finditer(content), 1):
        body = match.group("body")
        declared = {
            key: int(value)
            for key, value in SHAPE_ATTR_REGEX.findall(match.group("attrs"))
        }
        page = _page_before(content, match.start())
        section_path = _section_path_before(content, match.start())
        attrs_text = match.group("attrs")
        stored_caption = re.search(r'\bcaption="([^"]*)"', attrs_text)
        stored_type = re.search(r'\btype="([^"]*)"', attrs_text)
        stored_signature = re.search(r"\bsig=([0-9a-f]+)", attrs_text)
        parts = _split_fused_table(body)

        for part_index, part in enumerate(parts, 1):
            rendered = _render_table(part["rows"])
            data_rows = max(0, len(part["rows"]) - 1)
            # A normalized document already carries these; recomputing would
            # discard a caption the splitter lifted out on an earlier pass.
            caption = part["caption"] or (stored_caption.group(1) if stored_caption and len(parts) == 1 else None)
            header_cells = part["rows"][0] if part["rows"] else []
            signature = (
                stored_signature.group(1)
                if stored_signature and len(parts) == 1
                else table_signature(header_cells, caption, part["rows"][1:])
            )
            # The sentinel's declared shape describes the grid as it arrived, so
            # it only still applies when nothing was regrouped: neither split
            # into parts, nor had a banner row lifted out of the header.
            trust_declared = len(parts) == 1 and caption is None
            rows = int(declared.get("rows") or data_rows) if trust_declared else data_rows
            tables.append({
                # Renumbered across logical tables so the count a person sees
                # matches the document. Stable within one read only — still not
                # a cross-document key.
                "table_id": f"table_{len(tables) + 1}",
                "ordinal": len(tables) + 1,
                "source_ordinal": source_ordinal,
                "source_part": part_index,
                "source_part_count": len(parts),
                "caption": caption,
                "page": page,
                "section_path": section_path,
                "rows": max(1, rows),
                "cols": len(part["rows"][0]) if part["rows"] else 1,
                "body": rendered,
                # Stable across documents: the key a later revision of the same
                # schedule will hash to. See ``table_signature``.
                "signature": signature,
                "content_hash": content_hash(rendered),
                # Every part comes from this one sentinel, so they share its span.
                "char_start": match.start(),
                "char_end": match.end(),
                "table_type": stored_type.group(1) if stored_type and len(parts) == 1 else None,
                "classification_confidence": None,
                "diagnostics": _diagnostics(rendered),
            })
    return tables


def merge_stored_metadata(
    tables: List[Dict[str, Any]],
    stored: Optional[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """Overlay ``index.tables`` records onto freshly extracted tables.

    Stored records were written one per sentinel, so they are matched on
    ``source_ordinal`` rather than the renumbered display ordinal. A record is
    only applied when its sentinel yielded a single table: once a sentinel has
    been split, the stored record describes the fused grid, which is a different
    object from any of the parts, and copying its classification onto each part
    would assert something nobody established.

    Bodies always come from ``index.content`` so there is one source of truth
    for the text; only fields the ingestion pipeline owns are taken from here.
    """
    if not stored:
        return tables

    by_source = {
        int(record.get("ordinal") or 0): record
        for record in stored
        if isinstance(record, dict)
    }
    for table in tables:
        if table.get("source_part_count", 1) != 1:
            continue
        record = by_source.get(table.get("source_ordinal", table["ordinal"]))
        if not record:
            continue
        for field in ("table_type", "classification_confidence", "classification_version"):
            if record.get(field) is not None:
                table[field] = record[field]
    return tables
