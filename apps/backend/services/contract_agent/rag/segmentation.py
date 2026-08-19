"""Legal document segmentation for contract indexing and citation retrieval."""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import fitz
import tiktoken

from core.config import Settings
from utils.secure_logger import log_exception
from utils.text_cleanup import clean_text_encoding

from .schemas import TextSegment

settings = Settings()
logger = logging.getLogger(__name__)

# Module-level tiktoken encoder cache — expensive to create, so reuse across
# all segmentation and prompt-budgeting calls.
_tokenizer = None


def _get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        _tokenizer = tiktoken.get_encoding("cl100k_base")
    return _tokenizer


def _table_token_count(text: str) -> int:
    """Count table tokens with the shared embedding tokenizer."""
    return len(_get_tokenizer().encode(text or ""))


def _linearize_table_row(header: str, row: str) -> str:
    """Convert one oversized pipe row into compact labelled text."""
    headers = [cell.strip() for cell in header.strip().strip("|").split("|")]
    values = [cell.strip() for cell in row.strip().strip("|").split("|")]
    pairs = [
        f"{headers[index] or f'Column {index + 1}'}: {value}"
        for index, value in enumerate(values)
    ]
    return "; ".join(pairs)


def _split_table(body: str, *, max_tokens: int) -> List[str]:
    """Split a markdown table on rows while repeating its header."""
    lines = [line for line in body.splitlines() if line.strip()]
    if len(lines) < 2 or _table_token_count(body) <= max_tokens:
        return [body]

    header, delimiter = lines[:2]
    data_rows = lines[2:]
    parts: List[str] = []
    current_rows: List[str] = []
    for row in data_rows:
        candidate_rows = [*current_rows, row]
        candidate = "\n".join([header, delimiter, *candidate_rows])
        if current_rows and _table_token_count(candidate) > max_tokens:
            parts.append("\n".join([header, delimiter, *current_rows]))
            current_rows = []
            candidate = "\n".join([header, delimiter, row])
        if _table_token_count(candidate) > max_tokens:
            if current_rows:
                parts.append("\n".join([header, delimiter, *current_rows]))
                current_rows = []
            linearized = _linearize_table_row(header, row)
            if _table_token_count(linearized) > max_tokens:
                logger.warning("Table row exceeds token budget; falling back to character chunks")
                step = max(1, max_tokens * 4)
                parts.extend(linearized[index:index + step] for index in range(0, len(linearized), step))
            else:
                parts.append(linearized)
            continue
        current_rows.append(row)

    if current_rows:
        parts.append("\n".join([header, delimiter, *current_rows]))
    return parts or [body]


class DocumentSegmenter:
    """Handles document segmentation into hierarchical text units."""

    SECTION_TAG_KEYWORDS = {
        "assignment": ["assignment", "assign", "transfer"],
        "confidentiality": ["confidential", "non-disclosure", "nda"],
        "definitions": ["definition", "defined term", "means"],
        "deliverable": ["deliverable", "delivery", "milestone", "acceptance"],
        "dispute_resolution": ["dispute", "arbitration", "mediation", "litigation"],
        "force_majeure": ["force majeure", "act of god"],
        "governing_law": ["governing law", "jurisdiction", "choice of law"],
        "indemnification": ["indemnif", "hold harmless"],
        "ip_ownership": ["intellectual property", "copyright", "trademark", "patent"],
        "liability": ["liability", "damages", "limitation of liability"],
        "notice": ["notice", "notification"],
        "obligation": ["shall", "must", "required", "responsible", "covenant"],
        "payment": ["payment", "fee", "fees", "invoice", "price", "pricing", "rate"],
        "penalty": ["penalty", "liquidated damages", "late fee", "service credit"],
        "privacy": ["privacy", "data protection", "personal data", "gdpr"],
        "renewal": ["renewal", "extend", "extension"],
        "sla": ["service level", "sla", "uptime", "availability"],
        "termination": ["termination", "terminate", "expiry", "breach", "default", "cure"],
        "warranty": ["warranty", "warrant", "guarantee"],
    }

    VALUE_PATTERNS = [
        (re.compile(r"(?:\$|USD\s*)\s?\d[\d,]*(?:\.\d+)?", re.IGNORECASE), "money"),
        (re.compile(r"\b\d+(?:\.\d+)?\s?%", re.IGNORECASE), "percentage"),
        (re.compile(r"\b\d+(?:\.\d+)?\s*(?:business\s+)?(?:days?|weeks?|months?|years?)\b", re.IGNORECASE), "duration"),
        (re.compile(r"\b\d+(?:\.\d+)?\s*(?:hours?|minutes?|seconds?)\b", re.IGNORECASE), "time"),
        (re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b", re.IGNORECASE), "date"),
        (re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"), "date"),
        (re.compile(r"\b(?:within|no later than|not later than|before|after|by)\s+[^.;\n]{0,120}?(?:days?|weeks?|months?|years?|hours?|minutes?|\d{4})\b", re.IGNORECASE), "deadline"),
        (re.compile(r"\b(?:rate\s*card|ratecard|pricing|price|fee|fees|charge|charges)\b[^.;\n]{0,120}", re.IGNORECASE), "rate"),
    ]

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.page_marker_regex = re.compile(r"(?:\{(\d+)\}-+\s*|---\s*Page\s+(\d+)\s*---\s*)", re.IGNORECASE)
        self.table_marker_regex = re.compile(
            r"<!--TABLE:START(?P<attrs>[^>]*)-->\n(?P<body>.*?)\n<!--TABLE:END[^>]*-->",
            re.DOTALL,
        )

    def generate_segment_id(self, text: str, segment_type: str, index: int) -> str:
        content_hash = hashlib.md5(text.encode()).hexdigest()[:8]
        return f"{segment_type}_{index}_{content_hash}"

    def segment_text(self, text: str, page_number: Optional[int] = None) -> List[TextSegment]:
        segments = []
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        current_index = 0

        for para_idx, paragraph in enumerate(paragraphs):
            para_start = text.find(paragraph, current_index)
            if para_start == -1:
                para_start = current_index
            para_end = para_start + len(paragraph)

            para_id = self.generate_segment_id(paragraph, "paragraph", para_idx)
            para_segment = TextSegment(
                id=para_id,
                text=paragraph,
                type="paragraph",
                start_index=para_start,
                end_index=para_end,
                page_number=page_number
            )
            segments.append(para_segment)

            sentences = self._split_into_sentences(paragraph)
            sentence_offset_in_para = 0

            for sent_idx, sentence_text in enumerate(sentences):
                if sentence_text.strip():
                    sent_start_in_para = paragraph.find(sentence_text, sentence_offset_in_para)
                    if sent_start_in_para >= 0:
                        sent_start_abs = para_start + sent_start_in_para
                        sent_end_abs = sent_start_abs + len(sentence_text)

                        sent_id = self.generate_segment_id(sentence_text.strip(), "sentence", sent_idx)
                        sent_segment = TextSegment(
                            id=sent_id,
                            text=sentence_text.strip(),
                            type="sentence",
                            start_index=sent_start_abs,
                            end_index=sent_end_abs,
                            parent_id=para_id,
                            page_number=page_number
                        )
                        segments.append(sent_segment)
                        sentence_offset_in_para = sent_start_in_para + len(sentence_text)
            current_index = para_end
        return segments

    def _split_into_sentences(self, text: str) -> List[str]:
        sentences = re.split(r'(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|\!)\s', text)
        result = [s.strip() for s in sentences if s.strip()]
        return result if result else [text]

    def _page_number_from_marker_match(self, match: re.Match) -> Optional[int]:
        marker_value = match.group(1) or match.group(2)
        try:
            return int(marker_value) if marker_value is not None else None
        except ValueError:
            return None

    def segment_text_with_page_markers(self, text: str) -> Tuple[str, List[TextSegment]]:
        text = clean_text_encoding(text or "")
        page_chunks = self._split_by_page_markers(text)
        return self._legal_segments_from_page_chunks(page_chunks)

    def _split_by_page_markers(self, text: str) -> List[Tuple[Optional[int], str]]:
        matches = list(self.page_marker_regex.finditer(text))
        if not matches:
            return [(None, text.strip())] if text.strip() else []

        chunks: List[Tuple[Optional[int], str]] = []
        leading_text = text[:matches[0].start()].strip()
        if leading_text:
            chunks.append((None, leading_text))

        for index, match in enumerate(matches):
            page_number = self._page_number_from_marker_match(match)
            chunk_start = match.end()
            chunk_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            chunk_text = text[chunk_start:chunk_end].strip()
            if chunk_text:
                chunks.append((page_number, chunk_text))

        return chunks

    def _strip_table_markers(self, text: str) -> Tuple[str, List[Tuple[int, int, Dict[str, int]]]]:
        """Remove table sentinels and return body spans with measured shape metadata."""
        matches = list(self.table_marker_regex.finditer(text))
        if not matches:
            return text, []

        parts: List[str] = []
        spans: List[Tuple[int, int, Dict[str, int]]] = []
        cursor = 0
        output_cursor = 0
        for match in matches:
            prefix = text[cursor:match.start()]
            parts.append(prefix)
            output_cursor += len(prefix)
            body = match.group("body")
            body_start = output_cursor
            parts.append(body)
            output_cursor += len(body)
            attrs = dict(
                (key, int(value))
                for key, value in re.findall(r"\b(rows|cols)=(\d+)", match.group("attrs"))
            )
            spans.append((body_start, output_cursor, attrs))
            cursor = match.end()
        suffix = text[cursor:]
        parts.append(suffix)
        return "".join(parts), spans

    def _legal_segments_from_page_chunks(self, page_chunks: List[Tuple[Optional[int], str]]) -> Tuple[str, List[TextSegment]]:
        full_text_parts: List[str] = []
        page_spans: List[Tuple[Optional[int], int, int]] = []
        table_spans: List[Tuple[int, int, Dict[str, int]]] = []
        cursor = 0

        for page_number, page_text in page_chunks:
            if not page_text.strip():
                continue
            raw_page_text = self.page_marker_regex.sub("", clean_text_encoding(page_text))
            cleaned_page_text, local_table_spans = self._strip_table_markers(raw_page_text)
            leading_trim = len(cleaned_page_text) - len(cleaned_page_text.lstrip())
            cleaned_page_text = cleaned_page_text.strip()
            if not cleaned_page_text:
                continue
            if full_text_parts:
                full_text_parts.append("\n\n")
                cursor += 2
            page_start = cursor
            full_text_parts.append(cleaned_page_text)
            cursor += len(cleaned_page_text)
            page_spans.append((page_number, page_start, cursor))
            for local_start, local_end, attrs in local_table_spans:
                table_start = page_start + max(0, local_start - leading_trim)
                table_end = page_start + min(len(cleaned_page_text), local_end - leading_trim)
                if table_end > table_start:
                    table_spans.append((table_start, table_end, attrs))

        full_text = "".join(full_text_parts).strip()
        if not full_text:
            return "", []

        segments = self._build_legal_segments(full_text, page_spans, table_spans)
        if not segments:
            self.logger.warning("Legal chunking produced no segments; falling back to paragraph chunks.")
            segments = self._fallback_meso_segments(full_text, page_spans, table_spans)
        return full_text, segments

    def _estimated_tokens(self, text: str) -> int:
        if not text:
            return 0
        return len(_get_tokenizer().encode(text))

    def _stable_segment_id(self, text: str, segment_type: str, start_index: int) -> str:
        content_hash = hashlib.md5(f"{segment_type}:{start_index}:{text[:500]}".encode()).hexdigest()[:10]
        return f"{segment_type}_{start_index}_{content_hash}"

    def _detect_section_heading(self, line: str) -> Tuple[Optional[str], int]:
        stripped = line.strip()
        if not stripped or len(stripped) > 180:
            return None, -1

        markdown_match = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if markdown_match:
            return markdown_match.group(2).strip(), len(markdown_match.group(1))

        legal_patterns = [
            (r"^(Article\s+[A-Z0-9IVXLC]+(?:[.:\-\s].*)?)$", 1),
            (r"^(Part\s+[A-Z0-9IVXLC]+(?:[.:\-\s].*)?)$", 1),
            (r"^(Schedule\s+[A-Z0-9IVXLC]+(?:[.:\-\s].*)?)$", 1),
            (r"^(Exhibit\s+[A-Z0-9IVXLC]+(?:[.:\-\s].*)?)$", 1),
            (r"^(Annex\s+[A-Z0-9IVXLC]+(?:[.:\-\s].*)?)$", 1),
            (r"^(Appendix\s+[A-Z0-9IVXLC]+(?:[.:\-\s].*)?)$", 1),
            (r"^(Section\s+\d+(?:\.\d+)*(?:[.:\-\s].*)?)$", 2),
            (r"^(Clause\s+\d+(?:\.\d+)*(?:[.:\-\s].*)?)$", 2),
            (r"^((?:\d+(?:\.\d+)+|\d+\.)\s+[A-Z][A-Za-z0-9][^.;]{2,140})$", 2),
        ]
        for pattern, level in legal_patterns:
            match = re.match(pattern, stripped, flags=re.IGNORECASE)
            if match:
                title = match.group(1).strip()
                if not self._looks_like_legal_heading(title):
                    continue
                number_depth = title.split(" ", 1)[0].count(".")
                return title, min(5, level + max(0, number_depth))

        letters = re.sub(r"[^A-Za-z]", "", stripped)
        if 6 <= len(stripped) <= 80 and letters:
            uppercase_ratio = sum(1 for char in letters if char.isupper()) / len(letters)
            if uppercase_ratio >= 0.75 and not re.match(r"^page\s+\d+$", stripped, re.IGNORECASE):
                return stripped.title(), 2

        return None, -1

    def _looks_like_legal_heading(self, title: str) -> bool:
        """Filter out inline references, addresses, and signature prose that mimic headings."""
        cleaned = re.sub(r"\s+", " ", title or "").strip()
        if not cleaned:
            return False

        word_count = len(re.findall(r"[A-Za-z0-9]+", cleaned))
        if word_count > 18:
            return False

        if re.match(r"^\d+\s+", cleaned) and re.search(
            r"\b(?:street|st|road|rd|avenue|ave|drive|dr|suite|ste|blvd|sw|nw|se|ne)\b",
            cleaned,
            re.IGNORECASE,
        ):
            return False

        # "Section 7 below. The Committee..." is a prose reference, not a heading.
        legal_prefix = re.match(r"^(Section|Clause)\s+\d+(?:\.\d+)*", cleaned, re.IGNORECASE)
        if legal_prefix:
            remainder = cleaned[legal_prefix.end():].strip(" .:-")
            if re.search(r"[.!?]\s+[A-Z]", remainder):
                return False
            if re.search(r"\b(?:above|below|herein|thereof|hereto)\b", remainder, re.IGNORECASE) and word_count > 5:
                return False

        return True

    def _assign_section_tags(self, title: str, content: str) -> List[str]:
        combined = f"{title or ''} {content[:1000]}".lower()
        tags: List[str] = []
        for tag, keywords in self.SECTION_TAG_KEYWORDS.items():
            if any(keyword in combined for keyword in keywords):
                tags.append(tag)
        return tags

    def _page_range_for_span(
        self,
        start_index: int,
        end_index: int,
        page_spans: List[Tuple[Optional[int], int, int]],
    ) -> Tuple[Optional[int], Optional[int]]:
        pages: List[int] = []
        for page_number, page_start, page_end in page_spans:
            if page_number is None:
                continue
            if start_index < page_end and end_index > page_start:
                pages.append(page_number)
        if not pages:
            return None, None
        return min(pages), max(pages)

    def _extract_graph_ready_metadata(self, title: str, text: str) -> Dict[str, List[str]]:
        cleaned = clean_text_encoding(text or "")
        entities: List[str] = []
        entity_patterns = [
            r"\b[A-Z][A-Za-z&.,' -]{2,80}\s(?:Inc\.?|LLC|Ltd\.?|Corporation|Company|Bank|Authority|Airport|Department|Agency)\b",
            r'"([^"\n]{2,60})"',
        ]
        for pattern in entity_patterns:
            for match in re.finditer(pattern, cleaned):
                entity = (match.group(1) if match.lastindex else match.group(0)).strip(" .,:;")
                if entity and entity not in entities:
                    entities.append(entity)
                if len(entities) >= 10:
                    break
            if len(entities) >= 10:
                break

        cross_refs = []
        for match in re.finditer(r"\b(?:Section|Article|Clause|Exhibit|Schedule|Appendix|Annex)\s+[A-Za-z0-9.\-]+", cleaned, re.IGNORECASE):
            ref = match.group(0).strip().rstrip(".,;:")
            if ref not in cross_refs:
                cross_refs.append(ref)
            if len(cross_refs) >= 12:
                break

        known_parties = [
            "Company", "Contractor", "Customer", "Supplier", "Vendor", "Client", "Concessionaire",
            "Airport", "Authority", "Bank", "Employee", "Grantee", "Buyer", "Seller", "Lessor", "Lessee",
        ]
        obligation_parties = [
            party for party in known_parties
            if re.search(rf"\b{re.escape(party)}\b", cleaned)
        ][:8]

        referenced_documents = []
        referenced_patterns = [
            r"\b(?:rate\s*card|ratecard|statement of work|SOW|SLA|service level agreement|purchase order|work order)\b",
            r"\b(?:Exhibit|Schedule|Appendix|Annex)\s+[A-Za-z0-9.\-]+\b",
        ]
        for pattern in referenced_patterns:
            for match in re.finditer(pattern, cleaned, re.IGNORECASE):
                reference = match.group(0).strip().rstrip(".,;:")
                if reference not in referenced_documents:
                    referenced_documents.append(reference)
                if len(referenced_documents) >= 10:
                    break
            if len(referenced_documents) >= 10:
                break

        if title and title not in entities and len(entities) < 10:
            title_entity = re.sub(r"^(Article|Section|Clause|Schedule|Exhibit|Appendix|Annex)\s+[A-Za-z0-9.\-]+[:.\-\s]*", "", title, flags=re.IGNORECASE).strip()
            if 3 <= len(title_entity) <= 80:
                entities.append(title_entity)

        return {
            "entities": entities,
            "cross_refs": cross_refs,
            "obligation_parties": obligation_parties,
            "referenced_documents": referenced_documents,
        }

    def _make_legal_segment(
        self,
        *,
        text: str,
        segment_type: str,
        start_index: int,
        end_index: int,
        page_spans: List[Tuple[Optional[int], int, int]],
        section_path: str,
        section_tags: List[str],
        parent_id: Optional[str] = None,
        value_types: Optional[List[str]] = None,
        preserve_whitespace: bool = False,
        table_rows: Optional[int] = None,
        table_cols: Optional[int] = None,
        table_part_index: Optional[int] = None,
        table_part_count: Optional[int] = None,
        allow_short: bool = False,
    ) -> Optional[TextSegment]:
        cleaned = clean_text_encoding(text or "").strip()
        if not preserve_whitespace:
            cleaned = re.sub(r"[ \t\f\v]+", " ", cleaned)
            cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        min_length = 1 if allow_short or segment_type == "table" else (30 if segment_type == "micro" else 60)
        if len(cleaned) < min_length:
            return None

        page_start, page_end = self._page_range_for_span(start_index, end_index, page_spans)
        metadata = self._extract_graph_ready_metadata(section_path, cleaned)
        segment_id = self._stable_segment_id(cleaned, segment_type, start_index)
        return TextSegment(
            id=segment_id,
            text=cleaned,
            type=segment_type,
            start_index=start_index,
            end_index=end_index,
            parent_id=parent_id,
            page_number=page_start,
            chunk_schema_version=getattr(settings, "chunk_schema_version", 2),
            chunk_level=segment_type,
            section_path=section_path,
            section_tags=section_tags,
            page_start=page_start,
            page_end=page_end,
            char_start=start_index,
            char_end=end_index,
            parent_chunk_id=parent_id,
            token_count=self._estimated_tokens(cleaned),
            value_types=value_types or [],
            table_rows=table_rows,
            table_cols=table_cols,
            table_part_index=table_part_index,
            table_part_count=table_part_count,
            **metadata,
        )

    def _section_starts(self, text: str) -> List[Tuple[int, str, int]]:
        starts: List[Tuple[int, str, int]] = []
        cursor = 0
        for line in text.splitlines(keepends=True):
            stripped = line.strip()
            title, level = self._detect_section_heading(stripped)
            if title:
                starts.append((cursor, title, level))
            cursor += len(line)

        deduped: List[Tuple[int, str, int]] = []
        seen_positions = set()
        for start, title, level in sorted(starts, key=lambda item: item[0]):
            if start in seen_positions:
                continue
            deduped.append((start, title, level))
            seen_positions.add(start)
        return deduped

    def _structural_sections(self, text: str) -> List[Dict[str, Any]]:
        starts = self._section_starts(text)
        if not starts:
            return [{
                "start": 0,
                "end": len(text),
                "title": "Document",
                "level": 1,
                "path": "Document",
                "tags": self._assign_section_tags("Document", text),
                "has_child": False,
            }]

        if starts[0][0] > 0:
            starts.insert(0, (0, "Document Preamble", 1))

        sections: List[Dict[str, Any]] = []
        stack: List[Tuple[int, str]] = []
        for index, (start, title, level) in enumerate(starts):
            end = len(text)
            for next_start, _next_title, next_level in starts[index + 1:]:
                if next_level <= level:
                    end = next_start
                    break
            if end <= start:
                continue
            while stack and stack[-1][0] >= level:
                stack.pop()
            path_parts = [part for _, part in stack] + [title]
            section_text = text[start:end]
            sections.append({
                "start": start,
                "end": end,
                "title": title,
                "level": level,
                "path": " > ".join(path_parts),
                "tags": self._assign_section_tags(title, section_text),
                "has_child": False,
            })
            stack.append((level, title))

        for index, section in enumerate(sections):
            section["has_child"] = any(
                child["start"] > section["start"]
                and child["end"] <= section["end"]
                and child["level"] > section["level"]
                for child in sections[index + 1:]
            )
        return sections

    def _paragraph_blocks_excluding_tables(
        self,
        text: str,
        *,
        excluded_spans: List[Tuple[int, int]],
    ) -> List[Tuple[int, int, str]]:
        """Return prose blocks split around table spans so no text is visited twice."""
        if not excluded_spans:
            return self._paragraph_blocks(text)
        blocks: List[Tuple[int, int, str]] = []
        for block_start, block_end, _block_text in self._paragraph_blocks(text):
            intervals = [(block_start, block_end)]
            for excluded_start, excluded_end in excluded_spans:
                next_intervals: List[Tuple[int, int]] = []
                for start, end in intervals:
                    if excluded_end <= start or excluded_start >= end:
                        next_intervals.append((start, end))
                        continue
                    if start < excluded_start:
                        next_intervals.append((start, excluded_start))
                    if excluded_end < end:
                        next_intervals.append((excluded_end, end))
                intervals = next_intervals
            for start, end in intervals:
                content = text[start:end].strip()
                if content:
                    leading = len(text[start:end]) - len(text[start:end].lstrip())
                    actual_start = start + leading
                    blocks.append((actual_start, actual_start + len(content), content))
        return blocks

    def _table_segments_for_section(
        self,
        *,
        full_text: str,
        section: Dict[str, Any],
        page_spans: List[Tuple[Optional[int], int, int]],
        table_spans: List[Tuple[int, int, Dict[str, int]]],
        parent_id: Optional[str] = None,
    ) -> List[TextSegment]:
        """Create atomic table chunks while retaining every source row in citations."""
        segments: List[TextSegment] = []
        max_tokens = max(128, getattr(settings, "table_max_tokens", 1500))
        section_tables = [
            (start, end, attrs)
            for start, end, attrs in table_spans
            if section["start"] <= start and end <= section["end"]
        ]
        for table_start, table_end, attrs in section_tables:
            body = full_text[table_start:table_end]
            lines = [line for line in body.splitlines() if line.strip()]
            if len(lines) >= 2:
                computed_rows = max(1, len(lines) - 2)
                computed_cols = max(1, len(lines[0].strip().strip("|").split("|")))
            else:
                computed_rows = 1
                computed_cols = 1
            rows = attrs.get("rows") or computed_rows
            cols = attrs.get("cols") or computed_cols
            parts = _split_table(body, max_tokens=max_tokens)
            if len(parts) > 40:
                logger.warning(
                    "Table at %s-%s produced %d parts; preserving rows in a capped final part",
                    table_start,
                    table_end,
                    len(parts),
                )
                header_lines = lines[:2]
                consumed_row_count = sum(
                    1
                    for part in parts[:39]
                    for line in part.splitlines()[2:]
                    if line.strip().startswith("|")
                )
                remaining_rows = lines[2 + consumed_row_count:]
                parts = [*parts[:39], "\n".join([*header_lines, *remaining_rows])]

            section_tags = sorted(set([
                *(section.get("tags") or []),
                *self._assign_section_tags(section.get("path", ""), body.replace("|", " ")),
                "table",
            ]))
            parent_segment: Optional[TextSegment] = None
            if len(parts) > 1:
                summary_lines = lines[: min(len(lines), 7)]
                summary_text = f"Table summary: {rows} rows x {cols} columns\n" + "\n".join(summary_lines)
                parent_segment = self._make_legal_segment(
                    text=summary_text,
                    segment_type="table",
                    start_index=table_start,
                    end_index=table_end,
                    page_spans=page_spans,
                    section_path=section["path"],
                    section_tags=section_tags,
                    parent_id=parent_id,
                    preserve_whitespace=True,
                    table_rows=rows,
                    table_cols=cols,
                    table_part_count=len(parts),
                )
                if parent_segment:
                    segments.append(parent_segment)

            search_cursor = table_start
            part_segments: List[TextSegment] = []
            for part_index, part in enumerate(parts, 1):
                if len(parts) == 1:
                    row_start = table_start
                    row_end = table_end
                    first_row = ""
                else:
                    first_row = next((line for line in part.splitlines()[2:] if line.strip()), "")
                    row_start = full_text.find(first_row, search_cursor) if first_row else -1
                if row_start < table_start:
                    row_start = table_start
                row_end = min(table_end, row_start + len(first_row)) if first_row else table_end
                if len(parts) > 1 and "\n" in part:
                    last_row = next((line for line in reversed(part.splitlines()[2:]) if line.strip()), first_row)
                    last_start = full_text.find(last_row, row_start) if last_row else row_start
                    if last_start >= row_start:
                        row_end = min(table_end, last_start + len(last_row))
                search_cursor = max(search_cursor, row_end)
                segment = self._make_legal_segment(
                    text=part,
                    segment_type="table",
                    start_index=row_start,
                    end_index=max(row_start + 1, row_end),
                    page_spans=page_spans,
                    section_path=section["path"],
                    section_tags=section_tags,
                    parent_id=parent_segment.id if parent_segment else parent_id,
                    preserve_whitespace=True,
                    table_rows=rows,
                    table_cols=cols,
                    table_part_index=part_index if len(parts) > 1 else None,
                    table_part_count=len(parts) if len(parts) > 1 else None,
                )
                if segment:
                    part_segments.append(segment)
            if parent_segment:
                parent_segment.child_chunk_ids.extend(segment.id for segment in part_segments)
            segments.extend(part_segments)
        return segments

    def _paragraph_blocks(self, text: str) -> List[Tuple[int, int, str]]:
        blocks: List[Tuple[int, int, str]] = []
        cursor = 0
        for raw_block in re.split(r"\n\s*\n", text):
            block = raw_block.strip()
            if not block:
                cursor += len(raw_block) + 2
                continue
            start = text.find(block, cursor)
            if start < 0:
                start = cursor
            end = start + len(block)
            blocks.append((start, end, block))
            cursor = end
        return blocks

    def _sentence_windows(self, text: str, *, max_chars: int) -> List[Tuple[int, int, str]]:
        sentence_matches = list(re.finditer(r"[^.!?\n]+(?:[.!?]+|\n|$)", text))
        if not sentence_matches:
            return [(0, len(text), text)]

        windows: List[Tuple[int, int, str]] = []
        current_start: Optional[int] = None
        current_end = 0
        current_text_parts: List[str] = []
        previous_sentence: Optional[Tuple[int, int, str]] = None

        def flush() -> None:
            nonlocal current_start, current_end, current_text_parts, previous_sentence
            if current_start is None or not current_text_parts:
                return
            windows.append((current_start, current_end, " ".join(part.strip() for part in current_text_parts).strip()))
            if previous_sentence:
                current_start, current_end, sentence_text = previous_sentence
                current_text_parts = [sentence_text]
            else:
                current_start = None
                current_end = 0
                current_text_parts = []

        for match in sentence_matches:
            sentence_text = match.group(0).strip()
            if not sentence_text:
                continue
            if current_start is None:
                current_start = match.start()
            candidate_len = len(" ".join([*current_text_parts, sentence_text]))
            if current_text_parts and candidate_len > max_chars:
                flush()
                if current_start is None:
                    current_start = match.start()
            current_text_parts.append(sentence_text)
            current_end = match.end()
            previous_sentence = (match.start(), match.end(), sentence_text)

        if current_text_parts and current_start is not None:
            windows.append((current_start, current_end, " ".join(part.strip() for part in current_text_parts).strip()))
        return windows

    def _meso_segments_for_section(
        self,
        *,
        full_text: str,
        section: Dict[str, Any],
        page_spans: List[Tuple[Optional[int], int, int]],
        parent_id: Optional[str] = None,
        table_spans: Optional[List[Tuple[int, int, Dict[str, int]]]] = None,
    ) -> List[TextSegment]:
        section_text = full_text[section["start"]:section["end"]]
        section_table_spans = table_spans or []
        relative_table_spans = [
            (max(0, start - section["start"]), min(len(section_text), end - section["start"]))
            for start, end, _attrs in section_table_spans
        ]
        blocks = self._paragraph_blocks_excluding_tables(
            section_text,
            excluded_spans=relative_table_spans,
        )
        min_chars = max(400, getattr(settings, "legal_meso_min_chars", 1200))
        max_chars = max(min_chars + 200, getattr(settings, "legal_meso_max_chars", 3000))
        segments: List[TextSegment] = []
        current_start: Optional[int] = None
        current_end: Optional[int] = None
        current_parts: List[str] = []

        def flush() -> None:
            nonlocal current_start, current_end, current_parts
            if current_start is None or current_end is None or not current_parts:
                return
            absolute_start = section["start"] + current_start
            absolute_end = section["start"] + current_end
            segment = self._make_legal_segment(
                text=section_text[current_start:current_end],
                segment_type="meso",
                start_index=absolute_start,
                end_index=absolute_end,
                page_spans=page_spans,
                section_path=section["path"],
                section_tags=section["tags"],
                parent_id=parent_id,
            )
            if segment:
                segments.append(segment)
            current_start = None
            current_end = None
            current_parts = []

        for block_start, block_end, block_text in blocks:
            if len(block_text) > max_chars:
                flush()
                for window_start, window_end, window_text in self._sentence_windows(block_text, max_chars=max_chars):
                    segment = self._make_legal_segment(
                        text=window_text,
                        segment_type="meso",
                        start_index=section["start"] + block_start + window_start,
                        end_index=section["start"] + block_start + window_end,
                        page_spans=page_spans,
                        section_path=section["path"],
                        section_tags=section["tags"],
                        parent_id=parent_id,
                    )
                    if segment:
                        segments.append(segment)
                continue

            next_len = len("\n\n".join([*current_parts, block_text]))
            if current_parts and next_len > max_chars and len("\n\n".join(current_parts)) >= min_chars:
                flush()

            if current_start is None:
                current_start = block_start
            current_end = block_end
            current_parts.append(block_text)

        flush()
        return segments

    def _compact_macro_text(self, section_text: str) -> str:
        max_chars = max(800, getattr(settings, "legal_macro_max_chars", 2600))
        cleaned = clean_text_encoding(section_text).strip()
        if len(cleaned) <= max_chars:
            return cleaned
        headings = [
            line.strip()
            for line in cleaned.splitlines()
            if self._detect_section_heading(line.strip())[0]
        ][:12]
        overview = cleaned[:max_chars].rsplit(" ", 1)[0].strip()
        if headings:
            return f"{overview}\n\nIncluded section headings: " + "; ".join(headings)
        return overview

    def _micro_segments_for_meso(
        self,
        meso_segment: TextSegment,
        full_text: str,
        page_spans: List[Tuple[Optional[int], int, int]],
    ) -> List[TextSegment]:
        if meso_segment.char_start is None or meso_segment.char_end is None:
            return []
        raw_text = full_text[meso_segment.char_start:meso_segment.char_end]
        context_chars = max(180, getattr(settings, "legal_micro_context_chars", 420))
        micros: List[TextSegment] = []
        seen_ranges: List[Tuple[int, int]] = []

        for pattern, value_type in self.VALUE_PATTERNS:
            for match in pattern.finditer(raw_text):
                local_start = match.start()
                local_end = match.end()
                left_sentence = raw_text.rfind(".", 0, local_start)
                left_newline = raw_text.rfind("\n", 0, local_start)
                context_start = max(left_sentence + 1 if left_sentence >= 0 else 0, left_newline + 1 if left_newline >= 0 else 0)
                context_start = max(0, min(context_start, local_start - context_chars // 2))
                right_sentence = raw_text.find(".", local_end)
                right_newline = raw_text.find("\n", local_end)
                candidates = [idx for idx in [right_sentence, right_newline] if idx >= 0]
                context_end = (min(candidates) + 1) if candidates else min(len(raw_text), local_end + context_chars // 2)
                if context_end - context_start < 80:
                    context_start = max(0, local_start - context_chars // 2)
                    context_end = min(len(raw_text), local_end + context_chars // 2)

                absolute_start = meso_segment.char_start + context_start
                absolute_end = meso_segment.char_start + context_end
                is_duplicate = False
                for seen_start, seen_end in seen_ranges:
                    overlap = min(seen_end, absolute_end) - max(seen_start, absolute_start)
                    union = max(seen_end, absolute_end) - min(seen_start, absolute_start)
                    if union > 0 and overlap / union > 0.75:
                        is_duplicate = True
                        break
                if is_duplicate:
                    continue
                seen_ranges.append((absolute_start, absolute_end))
                segment = self._make_legal_segment(
                    text=full_text[absolute_start:absolute_end],
                    segment_type="micro",
                    start_index=absolute_start,
                    end_index=absolute_end,
                    page_spans=page_spans,
                    section_path=meso_segment.section_path or "Document",
                    section_tags=sorted(set([*(meso_segment.section_tags or []), value_type])),
                    parent_id=meso_segment.id,
                    value_types=[value_type],
                )
                if segment:
                    micros.append(segment)
        return micros

    def _micro_segments_for_table(
        self,
        table_segment: TextSegment,
        full_text: str,
        page_spans: List[Tuple[Optional[int], int, int]],
    ) -> List[TextSegment]:
        """Extract capped value micros from labelled table rows without indexing numeric-only grids."""
        if table_segment.char_start is None or table_segment.char_end is None:
            return []
        raw_table = full_text[table_segment.char_start:table_segment.char_end]
        lines = [line for line in raw_table.splitlines() if line.strip()]
        if len(lines) < 3:
            return []
        header = lines[0]
        micros: List[TextSegment] = []
        search_cursor = table_segment.char_start
        seen_rows: set[Tuple[int, int]] = set()
        for row in lines[2:]:
            cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
            label = cells[0] if cells else ""
            if not re.search(r"[A-Za-z]", label) or not re.search(r"[A-Za-z0-9]", label):
                continue
            row_start = full_text.find(row, search_cursor)
            if row_start < table_segment.char_start:
                row_start = table_segment.char_start
            row_end = min(table_segment.char_end, row_start + len(row))
            search_cursor = max(search_cursor, row_end)
            if (row_start, row_end) in seen_rows:
                continue
            seen_rows.add((row_start, row_end))
            matched_types: List[str] = []
            for pattern, value_type in self.VALUE_PATTERNS:
                if pattern.search(row):
                    matched_types.append(value_type)
            if not matched_types:
                continue
            micro_text = f"{header}\n{row}"
            for value_type in matched_types:
                if len(micros) >= 50:
                    logger.warning("Capped table micros at 50 for segment %s", table_segment.id)
                    return micros
                segment = self._make_legal_segment(
                    text=micro_text,
                    segment_type="micro",
                    start_index=row_start,
                    end_index=row_end,
                    page_spans=page_spans,
                    section_path=table_segment.section_path or "Document",
                    section_tags=sorted(set([*(table_segment.section_tags or []), value_type, "table"])),
                    parent_id=table_segment.id,
                    value_types=[value_type],
                )
                if segment:
                    micros.append(segment)
        return micros

    def _combine_meso_segments(
        self,
        first: TextSegment,
        second: TextSegment,
        full_text: str,
        page_spans: List[Tuple[Optional[int], int, int]],
    ) -> Optional[TextSegment]:
        if first.char_start is None or first.char_end is None or second.char_start is None or second.char_end is None:
            return None
        start = min(first.char_start, second.char_start)
        end = max(first.char_end, second.char_end)
        if end <= start:
            return None

        section_paths = [path for path in [first.section_path, second.section_path] if path]
        if section_paths and section_paths[0] == section_paths[-1]:
            section_path = section_paths[0]
        else:
            section_path = " / ".join(dict.fromkeys(section_paths)) or "Document"

        section_tags = sorted(set([*(first.section_tags or []), *(second.section_tags or [])]))
        parent_id = first.parent_chunk_id if first.parent_chunk_id == second.parent_chunk_id else None
        return self._make_legal_segment(
            text=full_text[start:end],
            segment_type="meso",
            start_index=start,
            end_index=end,
            page_spans=page_spans,
            section_path=section_path,
            section_tags=section_tags,
            parent_id=parent_id,
        )

    def _merge_tiny_meso_segments(
        self,
        meso_segments: List[TextSegment],
        full_text: str,
        page_spans: List[Tuple[Optional[int], int, int]],
    ) -> List[TextSegment]:
        min_tokens = 40
        if len(meso_segments) <= 1:
            return meso_segments

        def should_merge(segment: TextSegment) -> bool:
            token_count = segment.token_count or self._estimated_tokens(segment.text)
            if token_count >= min_tokens:
                return False
            # Short but semantically tagged clauses are worth preserving as their own citation target.
            if segment.section_tags or segment.cross_refs or segment.referenced_documents:
                return False
            return True

        merged: List[TextSegment] = []
        index = 0
        while index < len(meso_segments):
            segment = meso_segments[index]
            if not should_merge(segment):
                merged.append(segment)
                index += 1
                continue

            if index + 1 < len(meso_segments):
                combined = self._combine_meso_segments(segment, meso_segments[index + 1], full_text, page_spans)
                if combined:
                    merged.append(combined)
                    index += 2
                    continue

            if merged:
                previous = merged.pop()
                combined = self._combine_meso_segments(previous, segment, full_text, page_spans)
                if combined:
                    merged.append(combined)
                else:
                    self.logger.warning(
                        "Preserving meso segments after merge failure: %s-%s and %s-%s",
                        previous.char_start,
                        previous.char_end,
                        segment.char_start,
                        segment.char_end,
                    )
                    merged.extend([previous, segment])
            else:
                merged.append(segment)
            index += 1

        return merged

    def _build_legal_segments(
        self,
        full_text: str,
        page_spans: List[Tuple[Optional[int], int, int]],
        table_spans: Optional[List[Tuple[int, int, Dict[str, int]]]] = None,
    ) -> List[TextSegment]:
        sections = self._structural_sections(full_text)
        macro_segments: List[TextSegment] = []
        meso_segments: List[TextSegment] = []
        table_segments: List[TextSegment] = []
        emitted_table_spans: set[Tuple[int, int]] = set()
        all_table_spans = table_spans or []

        def owned_tables(section: Dict[str, Any]) -> List[Tuple[int, int, Dict[str, int]]]:
            owned: List[Tuple[int, int, Dict[str, int]]] = []
            for table_start, table_end, attrs in all_table_spans:
                if not (section["start"] <= table_start and table_end <= section["end"]):
                    continue
                nested = any(
                    other is not section
                    and other["start"] >= section["start"]
                    and other["end"] <= section["end"]
                    and other["start"] <= table_start
                    and table_end <= other["end"]
                    and (other["end"] - other["start"]) < (section["end"] - section["start"])
                    for other in sections
                )
                if not nested:
                    owned.append((table_start, table_end, attrs))
            return owned

        for section in sections:
            section_text = full_text[section["start"]:section["end"]]
            section_tables = owned_tables(section)
            is_macro = section["level"] <= 2
            macro_id: Optional[str] = None
            if is_macro and len(section_text.strip()) >= 250:
                macro_text = self._compact_macro_text(section_text)
                macro_end = min(section["end"], section["start"] + len(macro_text))
                macro_segment = self._make_legal_segment(
                    text=macro_text,
                    segment_type="macro",
                    start_index=section["start"],
                    end_index=macro_end,
                    page_spans=page_spans,
                    section_path=section["path"],
                    section_tags=section["tags"],
                )
                if macro_segment:
                    macro_segments.append(macro_segment)
                    macro_id = macro_segment.id

            if is_macro and section.get("has_child"):
                macro_end = macro_segments[-1].char_end if macro_segments else section["start"]
                child_start = min(
                    (child_section["start"] for child_section in sections
                     if child_section["start"] > macro_end and child_section.get("level", 1) > 1),
                    default=section["end"],
                )
                if child_start > macro_end:
                    gap_section = {
                        "start": macro_end,
                        "end": child_start,
                        "path": section["path"],
                        "tags": section["tags"],
                    }
                    gap_tables = [
                        span for span in all_table_spans
                        if gap_section["start"] <= span[0]
                        and span[1] <= gap_section["end"]
                        and (span[0], span[1]) not in emitted_table_spans
                    ]
                    emitted_table_spans.update((span[0], span[1]) for span in gap_tables)
                    table_segments.extend(self._table_segments_for_section(
                        full_text=full_text,
                        section=gap_section,
                        page_spans=page_spans,
                        table_spans=gap_tables,
                        parent_id=macro_id,
                    ))
                    meso_segments.extend(self._meso_segments_for_section(
                        full_text=full_text,
                        section=gap_section,
                        page_spans=page_spans,
                        parent_id=macro_id,
                        table_spans=gap_tables,
                    ))
                continue

            section_tables = [
                span for span in section_tables
                if (span[0], span[1]) not in emitted_table_spans
            ]
            emitted_table_spans.update((span[0], span[1]) for span in section_tables)
            table_segments.extend(self._table_segments_for_section(
                full_text=full_text,
                section=section,
                page_spans=page_spans,
                table_spans=section_tables,
                parent_id=macro_id,
            ))
            meso_segments.extend(self._meso_segments_for_section(
                full_text=full_text,
                section=section,
                page_spans=page_spans,
                parent_id=macro_id,
                table_spans=section_tables,
            ))

        meso_segments = self._merge_tiny_meso_segments(meso_segments, full_text, page_spans)
        table_micros: List[TextSegment] = []
        for table_segment in table_segments:
            if table_segment.table_part_count and table_segment.table_part_index is None:
                continue
            micros = self._micro_segments_for_table(table_segment, full_text, page_spans)
            if micros:
                table_segment.child_chunk_ids.extend([micro.id for micro in micros])
                table_micros.extend(micros)

        segments: List[TextSegment] = [*macro_segments, *table_segments, *meso_segments, *table_micros]
        for meso_segment in meso_segments:
            micros = self._micro_segments_for_meso(meso_segment, full_text, page_spans)
            if micros:
                meso_segment.child_chunk_ids.extend([micro.id for micro in micros])
                segments.extend(micros)

        self._audit_span_coverage(full_text, segments, page_spans)
        return segments

    def _audit_span_coverage(
        self,
        full_text: str,
        segments: List[TextSegment],
        page_spans: List[Tuple[Optional[int], int, int]],
    ) -> List[Tuple[int, int]]:
        """Repair uncovered text spans and return the repaired intervals."""
        covered = sorted(
            (segment.char_start, segment.char_end)
            for segment in segments
            if segment.char_start is not None
            and segment.char_end is not None
            and segment.char_end > segment.char_start
            and segment.type in {"meso", "table"}
        )
        merged: List[Tuple[int, int]] = []
        for start, end in covered:
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            else:
                merged.append((start, end))

        gaps: List[Tuple[int, int]] = []
        cursor = 0
        for start, end in merged:
            if start > cursor:
                gaps.append((cursor, start))
            cursor = max(cursor, end)
        if cursor < len(full_text):
            gaps.append((cursor, len(full_text)))

        repaired: List[Tuple[int, int]] = []
        for gap_start, gap_end in gaps:
            gap_text = full_text[gap_start:gap_end]
            if not gap_text.strip():
                preceding = [segment for segment in segments if segment.char_end == gap_start]
                following = [segment for segment in segments if segment.char_start == gap_end]
                if preceding:
                    preceding[-1].char_end = gap_end
                elif following:
                    following[0].char_start = gap_start
                repaired.append((gap_start, gap_end))
                continue
            excerpt = gap_text[:120].replace("\n", " ")
            if gap_end - gap_start > 40:
                logger.warning(
                    "Legal chunk coverage gap %d-%d (%d chars): %s",
                    gap_start,
                    gap_end,
                    gap_end - gap_start,
                    excerpt,
                )
            section_path = "Document"
            section_tags: List[str] = []
            preceding = [segment for segment in segments if segment.char_end is not None and segment.char_end <= gap_start]
            if preceding:
                nearest = max(preceding, key=lambda segment: segment.char_end or 0)
                section_path = nearest.section_path or section_path
                section_tags = nearest.section_tags or section_tags
            repair = self._make_legal_segment(
                text=full_text[gap_start:gap_end],
                segment_type="meso",
                start_index=gap_start,
                end_index=gap_end,
                page_spans=page_spans,
                section_path=section_path,
                section_tags=section_tags,
                allow_short=True,
            )
            if repair:
                segments.append(repair)
                repaired.append((gap_start, gap_end))
        return repaired

    def _fallback_meso_segments(
        self,
        full_text: str,
        page_spans: List[Tuple[Optional[int], int, int]],
        table_spans: Optional[List[Tuple[int, int, Dict[str, int]]]] = None,
    ) -> List[TextSegment]:
        fallback_section = {
            "start": 0,
            "end": len(full_text),
            "path": "Document",
            "tags": self._assign_section_tags("Document", full_text),
        }
        return self._meso_segments_for_section(
            full_text=full_text,
            section=fallback_section,
            page_spans=page_spans,
            table_spans=table_spans,
        )

    def segment_pdf(self, pdf_path: Path, contract_name: str, output_target_dir: Optional[Path] = None) -> Tuple[str, List[TextSegment]]:
        try:
            self.logger.info(f"Segmenting PDF: {pdf_path}")
            pdf_document = fitz.open(pdf_path)
            page_chunks: List[Tuple[Optional[int], str]] = []

            for page_idx, page in enumerate(pdf_document):
                page_text_original = clean_text_encoding(page.get_text() or "")
                if not page_text_original.strip():
                    continue

                current_page_number_from_marker = None
                match = self.page_marker_regex.search(page_text_original)
                if match:
                    current_page_number_from_marker = self._page_number_from_marker_match(match)
                    if current_page_number_from_marker is not None:
                        self.logger.info(f"Found page marker on PDF page {page_idx + 1} (fitz index): indicated page {current_page_number_from_marker}. Snippet: '{page_text_original[max(0,match.start()-20):match.end()+20]}'")
                    else:
                        self.logger.warning(f"Could not parse page number from marker: {match.group(0)}")

                page_text_cleaned = self.page_marker_regex.sub("", page_text_original).strip()

                final_page_num_for_segment = page_idx + 1
                if current_page_number_from_marker is not None:
                    final_page_num_for_segment = current_page_number_from_marker
                    if final_page_num_for_segment != (page_idx + 1):
                        self.logger.warning(f"PDF page {page_idx+1} (fitz) has marker for page {final_page_num_for_segment}. Using marker's page number for segments.")

                if page_text_cleaned:
                    page_chunks.append((final_page_num_for_segment, page_text_cleaned))

            full_text, all_segments = self._legal_segments_from_page_chunks(page_chunks)
            self.logger.info(f"Created {len(all_segments)} legal chunks from PDF using markers where available.")

            if output_target_dir:
                output_path = output_target_dir / f"{contract_name}_pdf_full_text.txt"
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(full_text)
                self.logger.info(f"Saved full text from PDF to {output_path}")

            return full_text, all_segments

        except Exception as e:
            log_exception(logger, f"Error segmenting PDF {pdf_path}", e)
            return "", []


__all__ = ["DocumentSegmenter", "TextSegment"]
