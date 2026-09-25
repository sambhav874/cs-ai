"""Find a model's quote in the source text, and say where it is.

Every extracted record carries a quote, and a quote is only worth storing if
it is really in the contract. `SourceText.locate` answers that and returns the
span in the ORIGINAL text, so the record carries a page and character offsets
rather than just the words.

Matching is exact after a fixed normalisation that only removes presentation:
case, runs of whitespace, markdown emphasis, table pipes, page markers, the
several Unicode dashes and curly quotes. A model quoting "seven-day" from
"seven‑day", or "Penalty Structure:" from "**Penalty Structure:**", is
quoting correctly. There is no fuzzy matching: a paraphrase is not a quote.

Pure, no I/O.
"""
from __future__ import annotations

import bisect
import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")
_QUOTES = {ord("‘"): "'", ord("’"): "'", ord("“"): '"', ord("”"): '"'}
_DROP = set("*_`~")          # markdown emphasis: presentation, not content
_SPACE_LIKE = set("| ")  # table pipes and non-breaking spaces read as a gap

# Ingestion writes "--- Page N ---" (1-based) before each page's text. Marker's
# raw "{n}------" form is zero-based and normally rewritten, but is still read.
PAGE_MARKER = re.compile(r"(?:\{(\d+)\}-{3,}|---\s*Page\s+(\d+)\s*---)", re.IGNORECASE)
# A quote needs enough characters to point at one place.
MIN_QUOTE_CHARS = 8
# locate_between gives up after this many candidate starts: an anchor that
# common does not identify a clause.
MAX_ANCHOR_TRIES = 25


@dataclass(frozen=True)
class Span:
    start: int
    end: int


def _normalize_with_map(text: str) -> Tuple[str, List[int]]:
    """Normalised text, and for each of its characters the index it came from.

    Whitespace runs collapse to one space mapped to the run's first character;
    dropped characters map to nothing.
    """
    out: List[str] = []
    index: List[int] = []
    pending_space = -1
    for i, ch in enumerate(text):
        if ch in _DROP:
            continue
        if ch.isspace() or ch in _SPACE_LIKE:
            if pending_space < 0:
                pending_space = i
            continue
        if pending_space >= 0:
            if out:
                out.append(" ")
                index.append(pending_space)
            pending_space = -1
        for piece in ch.lower().translate(_DASHES).translate(_QUOTES):
            out.append(piece)  # lower() can lengthen a character; keep aligned
            index.append(i)
    return "".join(out), index


def _blank_markers(text: str) -> str:
    """Page markers replaced by spaces of the same length, so offsets hold."""
    return PAGE_MARKER.sub(lambda m: " " * len(m.group(0)), text or "")


def normalize(text: str) -> str:
    return _normalize_with_map(_blank_markers(text))[0]


class SourceText:
    """One document's text, normalised once, searched many times."""

    def __init__(self, text: str):
        self.text = text or ""
        self._norm, self._index = _normalize_with_map(_blank_markers(self.text))
        self._page_offsets: List[int] = []
        self._pages: List[int] = []
        for match in PAGE_MARKER.finditer(self.text):
            zero_based, one_based = match.group(1), match.group(2)
            page = int(one_based) if one_based is not None else int(zero_based) + 1
            self._page_offsets.append(match.start())
            self._pages.append(page)

    # ── quotes ────────────────────────────────────────────────────────────
    def locate(self, quote: Optional[str], *, after: int = 0) -> Optional[Span]:
        """Where `quote` is, as a span of the original text, or None.

        `after` is an original-text offset; only matches starting at or after
        it count.
        """
        needle = normalize(quote or "")
        if len(needle) < MIN_QUOTE_CHARS:
            return None
        from_norm = bisect.bisect_left(self._index, after) if after else 0
        pos = self._norm.find(needle, from_norm)
        if pos < 0:
            return None
        return Span(self._index[pos], self._index[pos + len(needle) - 1] + 1)

    def locate_between(self, start_anchor: str, end_anchor: str, *, max_chars: int) -> Optional[Span]:
        """The span that opens with `start_anchor` and closes with `end_anchor`.

        For clauses: the model names where a clause starts and ends instead of
        copying it, so the stored text is the contract's own by construction.
        The nearest end after each candidate start wins; a span longer than
        `max_chars` is rejected rather than guessed at.
        """
        cursor = 0
        for _ in range(MAX_ANCHOR_TRIES):
            begin = self.locate(start_anchor, after=cursor)
            if begin is None:
                return None
            close = self.locate(end_anchor, after=begin.start)
            if close is not None and close.end - begin.start <= max_chars:
                return Span(begin.start, close.end)
            cursor = begin.start + 1
        return None

    def display(self, span: Span) -> str:
        """The span's text for a reader: markers gone, whitespace collapsed,
        markdown emphasis stripped. Still the contract's words."""
        raw = PAGE_MARKER.sub(" ", self.text[span.start:span.end])
        raw = re.sub(r"[*_`~]+", "", raw)
        return re.sub(r"\s+", " ", raw).strip()

    # ── pages ─────────────────────────────────────────────────────────────
    @property
    def has_pages(self) -> bool:
        return bool(self._pages)

    def page_at(self, offset: int) -> Optional[int]:
        if not self._pages:
            return None
        i = bisect.bisect_right(self._page_offsets, offset) - 1
        return self._pages[i] if i >= 0 else 1

    def pages(self, span: Span) -> Tuple[Optional[int], Optional[int]]:
        return self.page_at(span.start), self.page_at(max(span.start, span.end - 1))
