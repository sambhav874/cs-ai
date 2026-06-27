"""DOCX generation and tracked-changes engine using python-docx and lxml.

Replaces the hand-rolled OOXML in document_artifacts.py with robust library-based
implementations. Follows the same patterns as Mike's backend (docx npm package for
generation, JSZip + fast-xml-parser for tracked changes), ported to Python.

Key design decisions:
  - Generation uses python-docx high-level API (styles, sections, tables, numbering).
  - Tracked changes use lxml on the underlying XML of a python-docx Document.
  - Before applying new edits, ALL existing tracked changes are resolved (accepted)
    so the paragraph text used for position matching is clean.
  - Edits use find + replace + context_before/context_after matching, with whitespace
    and unicode normalization (same as Mike's approach).
"""

from __future__ import annotations

import re
import zipfile
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import lxml.etree as ET
from docx import Document as DocxDocument
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Inches, Pt, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.table import CT_Tbl

from utils.text_cleanup import clean_text_encoding


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class DocxEngineError(Exception):
    """Base error for docx_engine operations."""


class EditNotFoundError(DocxEngineError):
    """Raised when an edit cannot be located in the document text."""


class EditAmbiguousError(DocxEngineError):
    """Raised when an edit matches multiple locations."""


class EditOverlapError(DocxEngineError):
    """Raised when edits overlap in the same paragraph."""


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DOCX_FONT = "Times New Roman"
DOCX_FONT_SIZE = Pt(11)
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XML_NS = "http://www.w3.org/XML/1998/namespace"

MAX_DOCX_PACKAGE_MEMBERS = 256
MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
MAX_DOCX_XML_BYTES = 5 * 1024 * 1024

NSMAP = {"w": W_NS}


def _w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class DocxSection:
    """A single section in a document to be generated."""
    heading: Optional[str] = None
    level: int = 1
    content: Optional[str] = None
    page_break: bool = False
    table: Optional[DocxTable] = None


@dataclass
class DocxTable:
    headers: List[str]
    rows: List[List[str]]


@dataclass
class EditInput:
    find: str
    replace: str
    context_before: str = ""
    context_after: str = ""
    reason: str = ""


@dataclass
class TrackedEditAnnotation:
    change_id: str
    del_w_id: Optional[str]
    ins_w_id: Optional[str]
    deleted_text: str
    inserted_text: str
    context_before: str = ""
    context_after: str = ""
    reason: str = ""

    def to_payload(self) -> Dict[str, Any]:
        return {
            "change_id": self.change_id,
            "del_w_id": self.del_w_id,
            "ins_w_id": self.ins_w_id,
            "deleted_text": self.deleted_text,
            "inserted_text": self.inserted_text,
            "context_before": self.context_before,
            "context_after": self.context_after,
            "reason": self.reason,
        }


@dataclass
class TrackedEditApplyResult:
    docx_bytes: bytes
    annotations: List[TrackedEditAnnotation]
    errors: List[Dict[str, Any]]


@dataclass
class EditHit:
    """Result of locating a find string in a document's paragraph text."""
    paragraph_index: int
    start: int
    end: int


# ---------------------------------------------------------------------------
# Text normalization (shared with document_artifacts.py)
# ---------------------------------------------------------------------------

def normalized_with_map(value: str) -> Tuple[str, List[int]]:
    """Lowercase, collapse whitespace runs to single space, return index map.

    Returns (normalized_text, index_map) where index_map[i] is the character
    position in the original string corresponding to normalized position i.
    Matches Mike's approach of whitespace-normalized matching.
    """
    norm_chars: List[str] = []
    index_map: List[int] = []
    last_was_space = False
    for idx, char in enumerate(value or ""):
        if char.isspace():
            if norm_chars and not last_was_space:
                norm_chars.append(" ")
                index_map.append(idx)
                last_was_space = True
            continue
        norm_chars.append(char.lower())
        index_map.append(idx)
        last_was_space = False
    while norm_chars and norm_chars[-1] == " ":
        norm_chars.pop()
        index_map.pop()
    return "".join(norm_chars), index_map


def _normalize_unicode(text: str) -> str:
    """Normalize unicode characters (smart quotes, dashes, non-breaking spaces)."""
    return (text
        .replace("\u2018", "'").replace("\u2019", "'").replace("\u2032", "'")
        .replace("\u201C", '"').replace("\u201D", '"').replace("\u2033", '"')
        .replace("\u2013", "-").replace("\u2014", "-")
        .replace("\u00A0", " ")
        .replace("\u200B", ""))


# ---------------------------------------------------------------------------
# DOCX utility functions (zip reading, XML parsing)
# ---------------------------------------------------------------------------

def read_docx_xml_file(docx_bytes: bytes, path: str) -> bytes:
    """Read a specific XML file from a DOCX (zip) archive."""
    with zipfile.ZipFile(BytesIO(docx_bytes)) as zf:
        return zf.read(path)


def parse_docx_xml(xml_bytes: bytes) -> ET.ElementBase:
    """Parse DOCX XML bytes into an lxml Element tree."""
    return ET.fromstring(xml_bytes)


# ---------------------------------------------------------------------------
# DOCX Generation (using python-docx)
# ---------------------------------------------------------------------------

def generate_docx(
    title: str,
    sections: List[DocxSection],
    *,
    landscape: bool = False,
) -> bytes:
    """Generate a DOCX from structured sections using python-docx.

    Mirrors Mike's generate_docx tool which accepts sections with heading,
    content, table, page_break, and landscape options.
    """
    doc = DocxDocument()

    # --- Page setup ---
    section = doc.sections[0]
    if landscape:
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width = Inches(11)
        section.page_height = Inches(8.5)
    else:
        section.orientation = WD_ORIENT.PORTRAIT
        section.page_width = Inches(8.5)
        section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)

    # --- Default font ---
    style = doc.styles["Normal"]
    font = style.font
    font.name = DOCX_FONT
    font.size = DOCX_FONT_SIZE
    font.color.rgb = RGBColor(0, 0, 0)
    pf = style.paragraph_format
    pf.space_after = Pt(6)
    pf.line_spacing = 1.15

    # --- Heading styles ---
    for level in range(1, 4):
        hs = doc.styles[f"Heading {level}"]
        hs.font.name = DOCX_FONT
        hs.font.color.rgb = RGBColor(0, 0, 0)
        hs.font.bold = True
        hs.font.size = {1: Pt(14), 2: Pt(12), 3: Pt(11)}.get(level, Pt(11))
        hs.paragraph_format.space_before = Pt(12)
        hs.paragraph_format.space_after = Pt(6)

    # --- Title ---
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(title.upper())
    run.bold = True
    run.font.name = DOCX_FONT
    run.font.size = Pt(14)
    p.paragraph_format.space_after = Pt(18)

    # --- Sections ---
    for sec in sections:
        if sec.page_break:
            doc.add_page_break()

        if sec.table:
            _add_table(doc, sec.table)
        elif sec.heading:
            doc.add_heading(sec.heading, level=min(sec.level, 3))

        if sec.content:
            paragraphs = sec.content.split("\n\n")
            for para_text in paragraphs:
                para_text = para_text.strip()
                if not para_text:
                    continue
                # Detect markdown-like lists
                lines = para_text.split("\n")
                p = None
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    bullet_match = re.match(r"^[-*•●]\s+(.+)$", line)
                    num_match = re.match(r"^(\d+[.)])\s+(.+)$", line)
                    if bullet_match:
                        p = doc.add_paragraph(style="List Bullet")
                        run = p.add_run(_clean_inline_markdown(bullet_match.group(1)))
                        run.font.name = DOCX_FONT
                        run.font.size = DOCX_FONT_SIZE
                    elif num_match:
                        p = doc.add_paragraph(style="List Number")
                        run = p.add_run(_clean_inline_markdown(num_match.group(2)))
                        run.font.name = DOCX_FONT
                        run.font.size = DOCX_FONT_SIZE
                    else:
                        if p is None or p.style.name.startswith("List"):
                            p = doc.add_paragraph()
                            run = p.add_run(_clean_inline_markdown(line))
                        else:
                            run = p.add_run("\n" + _clean_inline_markdown(line))
                        run.font.name = DOCX_FONT
                        run.font.size = DOCX_FONT_SIZE

    return _docx_to_bytes(doc)


def _add_table(doc: DocxDocument, table_data: DocxTable) -> None:
    """Add a formatted table to the document."""
    rows = len(table_data.rows) + 1  # +1 for header
    cols = len(table_data.headers)
    table = doc.add_table(rows=rows, cols=cols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    # Style table
    table.style = "Table Grid"

    # Header row
    for i, header in enumerate(table_data.headers):
        cell = table.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        run = p.add_run(header)
        run.bold = True
        run.font.name = DOCX_FONT
        run.font.size = Pt(10)
        # Shading
        shading = OxmlElement("w:shd")
        shading.set(qn("w:fill"), "F2F2F2")
        shading.set(qn("w:val"), "clear")
        cell._tc.get_or_add_tcPr().append(shading)

    # Data rows
    for r_idx, row_data in enumerate(table_data.rows):
        for c_idx, cell_text in enumerate(row_data):
            if c_idx < cols:
                cell = table.rows[r_idx + 1].cells[c_idx]
                cell.text = ""
                p = cell.paragraphs[0]
                run = p.add_run(cell_text)
                run.font.name = DOCX_FONT
                run.font.size = Pt(10)


# ---------------------------------------------------------------------------
# DOCX Text Extraction
# ---------------------------------------------------------------------------

def extract_docx_text(docx_bytes: bytes) -> str:
    """Extract all paragraph text from a DOCX file.

    The output is what the LLM should base its find/context strings on, since
    it exactly mirrors the string the anchor matcher operates against.
    Pre-existing tracked changes are resolved (accepted view) before extraction.
    
    Returns paragraphs joined by newlines.
    """
    doc = _load_docx(docx_bytes)
    lines: List[str] = []
    for para in doc.paragraphs:
        lines.append(para.text)
    # Also extract text from tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    lines.append(para.text)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tracked Changes — Apply Edits
# ---------------------------------------------------------------------------

def apply_tracked_edits(
    docx_bytes: bytes,
    edits: List[EditInput],
    *,
    author: str = "ContractSense",
) -> TrackedEditApplyResult:
    """Apply edits as Word tracked changes to an existing DOCX.

    CRITICAL FIX: Before matching text positions, all existing tracked changes
    are resolved (accepted) so the paragraph text is clean. This eliminates the
    position-mapping bug where _paragraph_accepted_text() strips <w:del> but
    the index map from normalized_with_map maps to raw XML positions.
    """
    if not edits:
        return TrackedEditApplyResult(
            docx_bytes=docx_bytes, annotations=[], errors=[{"index": 0, "reason": "edits array is empty"}]
        )

    # Step 1: Resolve all existing tracked changes so document is clean
    clean_bytes = _resolve_all_tracked_changes(docx_bytes)
    if clean_bytes is None:
        clean_bytes = docx_bytes

    # Step 2: Parse document XML with lxml
    files = _read_docx_package(clean_bytes)
    doc_xml_bytes = files.get("word/document.xml")
    if not doc_xml_bytes:
        return TrackedEditApplyResult(
            docx_bytes=docx_bytes, annotations=[], errors=[{"index": 0, "reason": "document.xml missing from docx"}]
        )

    tree = ET.fromstring(doc_xml_bytes)
    body = tree.find(_w("body"))
    if body is None:
        return TrackedEditApplyResult(
            docx_bytes=docx_bytes, annotations=[], errors=[{"index": 0, "reason": "w:body missing from document.xml"}]
        )

    # Step 3: Collect all paragraphs in render order (including those inside tables)
    paragraphs: List[ET.Element] = []
    _collect_paragraphs(body, paragraphs)
    
    # Step 4: Extract accepted-view text for each paragraph
    para_texts = [_paragraph_accepted_text(p) for p in paragraphs]

    # Step 5: Find existing max w:id for new changes
    max_w_id = _max_tracked_change_id(tree)

    # Step 6: Process each edit
    next_w_id = max_w_id + 1
    plans_by_para: Dict[int, List[Dict[str, Any]]] = {}
    annotations: List[TrackedEditAnnotation] = []
    errors: List[Dict[str, Any]] = []

    for edit_idx, edit in enumerate(edits):
        find = clean_text_encoding(edit.find or "")
        replace = clean_text_encoding(edit.replace or "")
        if not find and not replace:
            errors.append({"index": edit_idx, "reason": "empty edit"})
            continue
        if not find:
            errors.append({"index": edit_idx, "reason": "pure insertion requires matched text"})
            continue

        try:
            hit = _find_edit_hit(
                para_texts,
                find=find,
                context_before=edit.context_before,
                context_after=edit.context_after,
            )
        except EditNotFoundError as e:
            errors.append({"index": edit_idx, "reason": str(e), "find": find})
            continue
        except EditAmbiguousError as e:
            errors.append({"index": edit_idx, "reason": str(e), "find": find})
            continue

        pi = hit.paragraph_index
        existing = plans_by_para.get(pi, [])
        if any(hit.start < plan["end"] and hit.end > plan["start"] for plan in existing):
            errors.append({"index": edit_idx, "reason": "overlaps another edit in the same paragraph", "find": find})
            continue

        deleted_text = para_texts[pi][hit.start:hit.end]
        change_id = f"cs-{uuid4().hex[:12]}"
        del_w_id = str(next_w_id) if deleted_text else None
        next_w_id += 1 if deleted_text else 0
        ins_w_id = str(next_w_id) if replace else None
        next_w_id += 1 if replace else 0

        plan = {
            "start": hit.start,
            "end": hit.end,
            "deleted_text": deleted_text,
            "inserted_text": replace,
            "change_id": change_id,
            "del_w_id": del_w_id,
            "ins_w_id": ins_w_id,
            "reason": edit.reason,
            "context_before": edit.context_before,
            "context_after": edit.context_after,
        }
        existing.append(plan)
        plans_by_para[pi] = sorted(existing, key=lambda x: x["start"])
        annotations.append(TrackedEditAnnotation(
            change_id=change_id,
            del_w_id=del_w_id,
            ins_w_id=ins_w_id,
            deleted_text=deleted_text,
            inserted_text=replace,
            context_before=edit.context_before,
            context_after=edit.context_after,
            reason=edit.reason,
        ))

    if not annotations:
        return TrackedEditApplyResult(docx_bytes=docx_bytes, annotations=[], errors=errors)

    # Step 7: Apply plans to each paragraph
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    for pi, plans in plans_by_para.items():
        _rewrite_paragraph_with_edits(
            paragraphs[pi],
            para_texts[pi],
            plans,
            author=author,
            now=now,
        )

    # Step 8: Serialize back
    xml_bytes = ET.tostring(tree, xml_declaration=True, encoding="UTF-8", standalone=True)
    files["word/document.xml"] = xml_bytes
    result_bytes = _zip_docx_files(files)

    return TrackedEditApplyResult(
        docx_bytes=result_bytes,
        annotations=annotations,
        errors=errors,
    )


def _collect_paragraphs(parent: ET.Element, out: List[ET.Element]) -> None:
    """Recursively collect all w:p elements in render order."""
    for child in parent:
        tag = child.tag
        if tag == _w("p"):
            out.append(child)
        elif tag in (_w("tbl"), _w("tr"), _w("tc"), _w("sdt"), _w("sdtContent")):
            _collect_paragraphs(child, out)


def _paragraph_accepted_text(para: ET.Element) -> str:
    """Extract accepted-view text: include w:ins text, skip w:del entirely."""
    parts: List[str] = []
    for el in para.iter():
        tag = el.tag
        if tag in (_w("del"), _w("delText")):
            continue
        if tag == _w("t"):
            if el.text:
                parts.append(el.text)
        elif tag == _w("tab"):
            parts.append("\t")
        elif tag == _w("br"):
            parts.append("\n")
    return "".join(parts)


def _find_edit_hit(
    para_texts: List[str],
    *,
    find: str,
    context_before: str,
    context_after: str,
) -> EditHit:
    """Locate the unique position for an edit in the document text.

    Uses whitespace-normalized matching with unicode normalization, and requires
    context before/after to disambiguate. Matches Mike's approach.
    """
    if not find:
        raise EditNotFoundError("empty find text")

    find_norm, _ = normalized_with_map(_normalize_unicode(find))
    before_norm, _ = normalized_with_map(_normalize_unicode(context_before or ""))
    after_norm, _ = normalized_with_map(_normalize_unicode(context_after or ""))

    if not find_norm:
        raise EditNotFoundError("empty find text after normalization")

    hits: List[EditHit] = []
    for pi, text in enumerate(para_texts):
        norm_text, idx_map = normalized_with_map(_normalize_unicode(text))
        pos = norm_text.find(find_norm)
        while pos >= 0:
            end_norm = pos + len(find_norm)
            # Context check: before must end exactly before find
            before_ok = True
            if before_norm:
                before_text = norm_text[:pos].rstrip()
                before_ok = before_text.endswith(before_norm)
            # Context check: after must start exactly after find
            after_ok = True
            if after_norm:
                after_text = norm_text[end_norm:].lstrip()
                after_ok = after_text.startswith(after_norm)

            if before_ok and after_ok:
                orig_start = idx_map[pos] if pos < len(idx_map) else 0
                orig_end = idx_map[min(end_norm - 1, len(idx_map) - 1)] + 1 if end_norm > 0 else idx_map[-1] + 1
                hits.append(EditHit(paragraph_index=pi, start=orig_start, end=orig_end))
            pos = norm_text.find(find_norm, pos + max(1, len(find_norm)))

    if not hits:
        raise EditNotFoundError(f"could not locate find text with provided context")
    if len(hits) > 1:
        raise EditAmbiguousError(f"matched text is ambiguous; provide more context_before/context_after")
    return hits[0]


def _max_tracked_change_id(root: ET.Element) -> int:
    """Find the largest w:id across all tracked changes in the document."""
    max_id = 0
    for el in root.iter():
        tag = el.tag
        if tag not in (_w("ins"), _w("del")):
            continue
        raw_id = el.get(_w("id"))
        if raw_id and raw_id.isdigit():
            max_id = max(max_id, int(raw_id))
    return max_id


def _rewrite_paragraph_with_edits(
    para: ET.Element,
    text: str,
    plans: List[Dict[str, Any]],
    *,
    author: str,
    now: str,
) -> None:
    """Rewrite a paragraph's children to insert tracked changes.

    Builds a new children list for the paragraph, preserving non-run elements
    (bookmarks, existing tracked changes not being edited, etc.) that fall
    outside the edited range.
    """
    # Find which child indices correspond to the runs in the text range
    # We need to map character positions to child indices
    child_runs: List[int] = []
    run_texts: List[str] = []
    for ci, child in enumerate(para):
        if child.tag == _w("r"):
            t_text = _run_text(child)
            if t_text is not None:
                child_runs.append(ci)
                run_texts.append(t_text)

    if not child_runs:
        return

    # Build concatenated text and char-to-run mapping
    concat_text = ""
    char_to_run: List[int] = []
    for ri, rt in enumerate(run_texts):
        for _ in rt:
            char_to_run.append(ri)
        concat_text += rt

    if not concat_text:
        return

    # Sort plans by start position
    plans = sorted(plans, key=lambda p: p["start"])

    # We'll reconstruct the paragraph children.
    # Strategy: For each edited span, we emit:
    #   1. Normal runs for unedited text
    #   2. w:del for deleted text
    #   3. w:ins for inserted text

    new_children: List[ET.Element] = []
    cursor = 0
    first_edited_run_idx = min(char_to_run[plans[0]["start"]], child_runs[0])
    last_edited_run_idx = max(char_to_run[plans[-1]["end"] - 1], child_runs[-1])

    # Copy everything before the first edited run
    for ci in range(child_runs[0]):
        new_children.append(deepcopy(para[ci]))
    if child_runs[0] > 0:
        # There might be elements between the first run and earlier non-run elements
        pass  # already copied

    # Emit edits
    for plan_idx, plan in enumerate(plans):
        s, e = plan["start"], plan["end"]
        deleted = plan["deleted_text"]
        inserted = plan["inserted_text"]

        # Emit unaffected text before this edit
        if s > cursor:
            _emit_normal_text(new_children, concat_text, cursor, s, child_runs, char_to_run, run_texts, para)

        # Emit deletion
        if deleted and plan["del_w_id"]:
            del_el = ET.SubElement(ET.Element("_parent"), _w("del"))
            # Need to set parent properly
            del_el = ET.Element(_w("del"))
            del_el.set(_w("id"), plan["del_w_id"])
            del_el.set(_w("author"), author)
            del_el.set(_w("date"), now)
            runs_in_range = _get_runs_in_range(concat_text, s, e, char_to_run, child_runs, run_texts, para)
            for r in runs_in_range:
                # Convert w:t to w:delText
                _convert_to_del_text(r)
                del_el.append(r)
            new_children.append(del_el)

        # Emit insertion
        if inserted and plan["ins_w_id"]:
            ins_el = ET.Element(_w("ins"))
            ins_el.set(_w("id"), plan["ins_w_id"])
            ins_el.set(_w("author"), author)
            ins_el.set(_w("date"), now)
            r_el = ET.SubElement(ins_el, _w("r"))
            rpr = ET.SubElement(r_el, _w("rPr"))
            _add_run_props(rpr, color="008A3D", underline=True)
            t_el = ET.SubElement(r_el, _w("t"))
            t_el.set(f"{{{XML_NS}}}space", "preserve")
            t_el.text = inserted
            new_children.append(ins_el)

        cursor = e

    # Emit trailing text after last edit
    if cursor < len(concat_text):
        _emit_normal_text(new_children, concat_text, cursor, len(concat_text), child_runs, char_to_run, run_texts, para)

    # Copy everything after the last run's child index
    last_ci = child_runs[-1]
    for ci in range(last_ci + 1, len(para)):
        new_children.append(deepcopy(para[ci]))

    # Replace paragraph children
    for child in list(para):
        para.remove(child)
    for child in new_children:
        para.append(child)


def _run_text(run: ET.Element) -> Optional[str]:
    """Get the concatenated text from a w:r element."""
    texts = []
    for t in run.iter(_w("t")):
        if t.text:
            texts.append(t.text)
    return "".join(texts) if texts else None


def _emit_normal_text(
    new_children: List[ET.Element],
    concat_text: str,
    s: int,
    e: int,
    child_runs: List[int],
    char_to_run: List[int],
    run_texts: List[str],
    para: ET.Element,
) -> None:
    """Emit normal (non-edited) run elements for a character range."""
    if s >= e:
        return
    current_run = None
    for pos in range(s, e):
        if pos >= len(char_to_run):
            break
        ri = char_to_run[pos]
        ci = child_runs[ri]
        if current_run is None or char_to_run[pos] != char_to_run[pos - 1]:
            if current_run is not None:
                new_children.append(current_run)
            # Deep copy the original run
            current_run = deepcopy(para[ci])
            # Clear all t elements and rebuild
            for t in list(current_run.iter(_w("t"))):
                t.text = None
            # Remove delText
            for dt in list(current_run.iter(_w("delText"))):
                parent = dt.getparent()
                if parent is not None:
                    parent.remove(dt)
        # Add character to the current run's t element
        if current_run is not None:
            t_els = list(current_run.iter(_w("t")))
            if t_els:
                t_els[0].text = (t_els[0].text or "") + concat_text[pos]
    if current_run is not None:
        new_children.append(current_run)


def _get_runs_in_range(
    concat_text: str,
    s: int,
    e: int,
    char_to_run: List[int],
    child_runs: List[int],
    run_texts: List[str],
    para: ET.Element,
) -> List[ET.Element]:
    """Get deep copies of run elements covering a character range."""
    if s >= e:
        return []
    seen = set()
    result: List[ET.Element] = []
    for pos in range(s, e):
        if pos >= len(char_to_run):
            break
        ri = char_to_run[pos]
        if ri in seen:
            continue
        seen.add(ri)
        ci = child_runs[ri] if ri < len(child_runs) else child_runs[-1]
        result.append(deepcopy(para[ci]))
    return result


def _convert_to_del_text(run: ET.Element) -> None:
    """Convert w:t elements in a run to w:delText."""
    for t in list(run.iter(_w("t"))):
        t.tag = _w("delText")
    # Also handle nested t in rPr etc — only convert direct children of w:r
    for child in list(run):
        if child.tag == _w("t"):
            child.tag = _w("delText")
        elif child.tag != _w("rPr"):
            for sub in child.iter():
                if sub.tag == _w("t"):
                    sub.tag = _w("delText")


def _add_run_props(rpr: ET.Element, *, color: str = "000000", underline: bool = False, strike: bool = False) -> None:
    """Add run properties (font, size, color, effects) to a w:rPr element."""
    fonts = ET.SubElement(rpr, _w("rFonts"))
    fonts.set(_w("ascii"), DOCX_FONT)
    fonts.set(_w("hAnsi"), DOCX_FONT)
    sz = ET.SubElement(rpr, _w("sz"))
    sz.set(_w("val"), "22")
    szCs = ET.SubElement(rpr, _w("szCs"))
    szCs.set(_w("val"), "22")
    color_el = ET.SubElement(rpr, _w("color"))
    color_el.set(_w("val"), color)
    if strike:
        ET.SubElement(rpr, _w("strike"))
    if underline:
        u = ET.SubElement(rpr, _w("u"))
        u.set(_w("val"), "single")


# ---------------------------------------------------------------------------
# Tracked Changes — Resolve (Accept/Reject)
# ---------------------------------------------------------------------------

def resolve_tracked_changes(
    docx_bytes: bytes,
    change_ids: List[str],
    mode: str,
) -> Tuple[bytes, bool]:
    """Accept or reject tracked changes by their w:id values.

    Accept mode (accept): Remove w:ins wrapper, keep children; Remove w:del
    wrapper AND its children (text disappears).
    Reject mode (reject): Remove w:ins wrapper AND its children; Remove w:del
    wrapper, keep children, convert w:delText back to w:t.
    """
    wanted = {str(v) for v in change_ids if v}
    if mode not in ("accept", "reject") or not wanted:
        return docx_bytes, False

    files = _read_docx_package(docx_bytes)
    doc_xml = files.get("word/document.xml")
    if not doc_xml:
        return docx_bytes, False

    tree = ET.fromstring(doc_xml)
    found = _resolve_in_tree(tree, wanted, mode)

    if not found:
        return docx_bytes, False

    xml_bytes = ET.tostring(tree, xml_declaration=True, encoding="UTF-8", standalone=True)
    files["word/document.xml"] = xml_bytes
    return _zip_docx_files(files), True


def _resolve_in_tree(root: ET.Element, wanted: set, mode: str) -> bool:
    """Walk XML tree and resolve matching tracked changes."""
    found = False
    parent_map = {c: root for c in root}
    # Build parent map
    for el in root.iter():
        for child in el:
            parent_map[child] = el

    # Process in reverse document order to avoid index shifts
    elements_to_process: List[ET.Element] = []
    for el in root.iter():
        tag = el.tag
        if tag not in (_w("ins"), _w("del")):
            continue
        w_id = el.get(_w("id"))
        if w_id and w_id in wanted:
            elements_to_process.append(el)

    for el in elements_to_process:
        parent = parent_map.get(el)
        if parent is None:
            continue
        found = True
        tag = el.tag
        keep_children = (
            (tag == _w("ins") and mode == "accept")
            or (tag == _w("del") and mode == "reject")
        )
        if keep_children:
            idx = list(parent).index(el)
            children = list(el)
            if tag == _w("del") and mode == "reject":
                # Convert w:delText → w:t
                for child in children:
                    _convert_del_text_to_text(child)
            parent.remove(el)
            for offset, child in enumerate(children):
                parent.insert(idx + offset, child)
        else:
            # Remove wrapper and children entirely
            parent.remove(el)

    return found


def _convert_del_text_to_text(el: ET.Element) -> None:
    """Recursively convert w:delText elements to w:t."""
    if el.tag == _w("delText"):
        el.tag = _w("t")
    for child in list(el):
        _convert_del_text_to_text(child)


# ---------------------------------------------------------------------------
# Tracked Changes — Extract IDs
# ---------------------------------------------------------------------------

def extract_tracked_change_ids(docx_bytes: bytes) -> List[Dict[str, str]]:
    """Extract ordered list of {kind, w_id} for every tracked change."""
    files = _read_docx_package(docx_bytes)
    doc_xml = files.get("word/document.xml")
    if not doc_xml:
        return []
    tree = ET.fromstring(doc_xml)
    result: List[Dict[str, str]] = []
    for el in tree.iter():
        tag = el.tag
        if tag not in (_w("ins"), _w("del")):
            continue
        w_id = el.get(_w("id"))
        if w_id:
            result.append({
                "kind": "ins" if tag == _w("ins") else "del",
                "w_id": str(w_id),
            })
    return result


# ---------------------------------------------------------------------------
# Internal Helpers
# ---------------------------------------------------------------------------

def _resolve_all_tracked_changes(docx_bytes: bytes) -> Optional[bytes]:
    """Accept all existing tracked changes, producing a clean document.

    CRITICAL: This pre-processing step means we match against clean text,
    eliminating the position-mapping bug that occurs when existing <w:del>
    wrappers skew the character offsets.
    """
    ids = [c["w_id"] for c in extract_tracked_change_ids(docx_bytes)]
    if not ids:
        return None
    result, found = resolve_tracked_changes(docx_bytes, ids, "accept")
    return result if found else None


def _load_docx(docx_bytes: bytes) -> DocxDocument:
    """Load a DOCX from bytes using python-docx."""
    return DocxDocument(BytesIO(docx_bytes))


def _docx_to_bytes(doc: DocxDocument) -> bytes:
    """Serialize a python-docx Document to bytes."""
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _read_docx_package(docx_bytes: bytes) -> Dict[str, bytes]:
    """Read all files from a DOCX zip package safely."""
    with zipfile.ZipFile(BytesIO(docx_bytes), "r") as z:
        members = z.infolist()
        if len(members) > MAX_DOCX_PACKAGE_MEMBERS:
            raise DocxEngineError("DOCX package contains too many files")
        total = sum(m.file_size for m in members)
        if total > MAX_DOCX_UNCOMPRESSED_BYTES:
            raise DocxEngineError("DOCX package too large")
        for m in members:
            if m.filename.startswith("/") or ".." in m.filename.split("/"):
                raise DocxEngineError("Unsafe file path in DOCX")
        return {m.filename: z.read(m.filename) for m in members}


def _zip_docx_files(files: Dict[str, bytes]) -> bytes:
    """Re-zip a dict of {path: bytes} into a valid DOCX."""
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def _clean_inline_markdown(text: str) -> str:
    """Strip markdown formatting from text for DOCX embedding."""
    text = clean_text_encoding(text or "")
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[(?:\d+)(?:\s*,\s*\d+)*\]", "", text)
    return re.sub(r"\s+", " ", text).strip()
