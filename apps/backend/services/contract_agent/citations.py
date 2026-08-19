"""The one citation pipeline (plan 1.4, F-05).

Before this module the work was spread across three files and ran in the wrong
order. `react_runtime` parsed the model's `<CITATIONS>` block, resolved documents,
enriched pages from tool observations, and **rewrote the inline `[N]` markers**.
Only afterwards did `middleware._validate_citations` drop unsupported citations
and renumber the survivors — by which point the prose was already written against
the pre-validation numbering. Dropping the middle citation of three left the
prose pointing at the wrong evidence. The `【N】 → [N]` normalisation also ran in
four places (twice in `runner.py` alone).

One order, enforced by the two entry points below:

    parse the model's <CITATIONS> block
      -> resolve doc-N / UUID / filename to document records
      -> validate each quote against what the tools actually returned
      -> renumber the survivors
      -> rewrite [N] markers in the prose            (LAST, always)

`resolve_for_answer` does everything up to validation and is called while the
answer is being finished. `validate_and_finalize` does validation onward and is
called from the middleware's answer guard. Markers are rewritten exactly once, at
the end of the second step, using the old-ref -> new-ref map that renumbering
produced. Nothing outside this module contains a citation-marker regex.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple


# ── The only citation regexes in the codebase ─────────────────────────────────

#: Full-width bracket markers, which some providers emit instead of `[N]`,
#: optionally carrying a `†source` suffix: 【3†source】 or 【1, 2】.
CJK_MARKER_RE = re.compile(r"【(\d+(?:\s*,\s*\d+)*)(?:†[^】\n]*)?】")

#: The structured block the model appends after its prose.
CITATION_BLOCK_RE = re.compile(r"<CITATIONS?>[\s\S]*?(?:</CITATIONS?>|$)", re.IGNORECASE)
CITATION_BODY_RE = re.compile(r"<CITATIONS?>\s*([\s\S]*?)\s*(?:</CITATIONS?>|$)", re.IGNORECASE)

#: A plain inline marker.
MARKER_RE = re.compile(r"\[(\d+)\]")

#: A document-prefixed marker the model sometimes writes instead of a bare
#: number: [doc-0 #3], [doc-0 p.3], [doc-0: 3], [doc-0, #3].
DOC_MARKER_RE = re.compile(r"\[doc-\d+(?:\s*,\s*|\s*:\s*|\s+)(?:#|p\.|page\s*)?(\d+)\]")

#: A marker written as an opaque id (segment/evidence id) rather than a number.
ID_MARKER_RE = re.compile(r"\[([A-Za-z0-9:_\-]{8,})\]")

#: Quotes longer than this are trimmed — a citation should point at a clause,
#: not a page.
MAX_QUOTE_CHARS = 520

#: Fraction of a quote's content tokens that must appear in tool evidence for the
#: quote to count as supported.
SUPPORT_OVERLAP_RATIO = 0.40

_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "but",
    "by", "contract", "document", "for", "from", "had", "has",
    "have", "if", "in", "into", "is", "it", "its", "no", "not",
    "of", "on", "or", "shall", "such", "than", "that", "the",
    "their", "this", "to", "was", "were", "which", "will", "with",
}


# ── Text helpers ──────────────────────────────────────────────────────────────


def normalize_markers(text: str) -> str:
    """Fold full-width 【N】 markers into plain [N]. Idempotent."""
    if not text:
        return text
    return CJK_MARKER_RE.sub(lambda match: f"[{match.group(1)}]", text)


def strip_citation_block(answer: str) -> str:
    """Remove the `<CITATIONS>` block from the prose."""
    if not answer:
        return answer
    return CITATION_BLOCK_RE.sub("", answer).strip()


def used_refs(answer: str) -> Set[int]:
    """Marker numbers that actually appear in the prose."""
    return {int(value) for value in MARKER_RE.findall(answer or "")}


def normalize_text(value: str) -> str:
    """Lowercase, collapse whitespace, drop punctuation that varies between the
    source document and the model's rendering of it."""
    normalized = re.sub(r"\s+", " ", value or "").strip().lower()
    return re.sub(r"[\"'“”‘’\[\](){}]", "", normalized)


def content_tokens(value: str) -> List[str]:
    """Significant content words, for overlap-based support checks."""
    return [
        token
        for token in re.findall(r"[a-z][a-z0-9_$%.-]{2,}", (value or "").lower())
        if token not in _STOP_WORDS
    ]


def _overlap_ratio(quote_tokens: Set[str], other: str) -> float:
    if not quote_tokens:
        return 0.0
    other_tokens = set(content_tokens(other))
    if not other_tokens:
        return 0.0
    return len(quote_tokens & other_tokens) / len(quote_tokens)


def _supports(normalized_quote: str, quote_tokens: Set[str], evidence: str) -> bool:
    """Does one piece of observed evidence support this quote?

    Token overlap rather than substring containment, so minor paraphrasing,
    punctuation differences, and a quote slightly longer or shorter than the
    retrieved snippet do not cause false rejections.
    """
    if not evidence:
        return False
    if _overlap_ratio(quote_tokens, evidence) >= SUPPORT_OVERLAP_RATIO:
        return True
    return normalized_quote in evidence or evidence in normalized_quote


def parse_page_range(
    raw_page: Any,
) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """Parse a page value into (page, page_start, page_end).

    Accepts an int, a numeric string, "Page 4", or a range in any dash variant
    ("1-3", "1–3", "1—3").
    """
    if raw_page is None:
        return None, None, None
    if isinstance(raw_page, int):
        return raw_page, raw_page, raw_page
    if not isinstance(raw_page, str):
        try:
            value = int(raw_page)
        except (ValueError, TypeError):
            return None, None, None
        return value, value, value

    raw = raw_page.strip()
    if not raw:
        return None, None, None

    normalized = re.sub(
        r"[‐‑‒–—―−﹘﹣－]", "-", raw
    )
    range_match = re.fullmatch(r"(\d+)\s*-\s*(\d+)", normalized)
    if range_match:
        start = int(range_match.group(1))
        end = max(int(range_match.group(2)), start)
        return start, start, end

    single = re.search(r"\d+", raw)
    if single:
        value = int(single.group(0))
        return value, value, value
    return None, None, None


# ── Step 1: parse the model's block ───────────────────────────────────────────


def parse_citation_block(answer: str) -> List[Dict[str, Any]]:
    """Extract the raw citation dicts the model emitted.

    Tolerates a fenced block and, when the JSON array will not parse as a whole,
    falls back to scanning for individual objects — a truncated block should
    still yield the citations that did arrive intact.
    """
    match = CITATION_BODY_RE.search(answer or "")
    if not match:
        return []
    body = match.group(1).strip()
    if body.startswith("```"):
        lines = body.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        body = "\n".join(lines).strip()

    try:
        parsed = json.loads(body)
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    except Exception:
        pass

    recovered: List[Dict[str, Any]] = []
    for candidate in re.finditer(r"\{[\s\S]*?\}", body):
        try:
            item = json.loads(candidate.group(0))
        except Exception:
            continue
        if isinstance(item, dict):
            recovered.append(item)
    return recovered


# ── Step 2: resolve doc-N / UUID / filename to document records ───────────────


def build_document_index(state: Any) -> Dict[str, Dict[str, Any]]:
    """Map every label the model might use for a document to that document.

    The model is shown documents as `doc-0`, `doc-1`, ... in the user message, but
    it also sometimes writes the raw id or the filename. All three resolve here.
    """
    index: Dict[str, Dict[str, Any]] = {}
    context = state.context

    for position, document in enumerate(context.attached_documents or []):
        label = f"doc-{position}"
        document_id = document.get("document_id") or document.get("id") or ""
        filename = document.get("filename") or document.get("name") or label
        info = {
            "document_id": document_id,
            "filename": filename,
            "version_id": document.get("version_id"),
            "version_number": document.get("version_number"),
        }
        index[label] = info
        if document_id:
            index[str(document_id)] = info
        if filename:
            index[filename] = info

    # Documents that are in scope but were never attached still need a doc-N
    # label, since the model counts positionally over the scope list.
    for position, document_id in enumerate(context.selected_document_ids or []):
        label = f"doc-{position}"
        if label in index:
            continue
        filename = _filename_from_observations(state, document_id) or label
        info = {
            "document_id": document_id,
            "filename": filename,
            "version_id": None,
            "version_number": None,
        }
        index[label] = info
        index[document_id] = info
    return index


def _filename_from_observations(state: Any, document_id: str) -> Optional[str]:
    for tool in state.tools:
        observation = tool.observation
        if not isinstance(observation, dict):
            continue
        for match in observation.get("matches") or []:
            if not isinstance(match, dict):
                continue
            if match.get("document_id") == document_id or match.get("doc_id") == document_id:
                filename = match.get("filename")
                if filename:
                    return str(filename)
    return None


def resolve_citations(
    raw_citations: Sequence[Dict[str, Any]],
    state: Any,
) -> List[Dict[str, Any]]:
    """Turn raw model citations into annotations bound to real documents."""
    from bson import ObjectId

    index = build_document_index(state)
    context = state.context
    resolved: List[Dict[str, Any]] = []

    for item in raw_citations:
        try:
            ref = int(item.get("ref", 0))
        except (ValueError, TypeError):
            continue
        if ref <= 0:
            continue

        raw_doc_id = str(item.get("doc_id") or "").strip()
        quote = _unwrap_kpi_quote(str(item.get("quote") or "").strip())
        page, page_start, page_end = parse_page_range(item.get("page"))

        info = index.get(raw_doc_id)
        if not info:
            for key, value in index.items():
                if key.lower() == raw_doc_id.lower():
                    info = value
                    break

        document_id = (info or {}).get("document_id") or raw_doc_id
        filename = (info or {}).get("filename") or raw_doc_id

        # The model may have written a label rather than a real id. Fall back to
        # the scope so the citation still points at a document the reader can open.
        if not ObjectId.is_valid(document_id):
            fallback = _fallback_document_id(context)
            if fallback:
                document_id = fallback

        if not filename or filename in ("kpi_context", "doc-0", "doc-1") or not (info or {}).get("filename"):
            fallback_name = (context.displayed_document or {}).get("filename") or (
                context.visible_state or {}
            ).get("contract_name")
            if fallback_name:
                filename = fallback_name

        resolved.append(
            {
                "type": "citation_data",
                "ref": ref,
                "doc_id": document_id,
                "document_id": document_id,
                "version_id": (info or {}).get("version_id"),
                "version_number": (info or {}).get("version_number"),
                "filename": filename,
                "page": page,
                "page_start": page_start,
                "page_end": page_end,
                "quote": quote,
                "text": quote,
                "preview": quote,
            }
        )
    return resolved


def _unwrap_kpi_quote(quote: str) -> str:
    """A KPI-sourced citation sometimes arrives as the whole KPI record as JSON.
    Pull the human-readable clause out of it."""
    if not (quote.startswith("{") and ("kpi_id" in quote or "kpi_type" in quote)):
        return quote
    try:
        parsed = json.loads(quote)
    except Exception:
        return quote
    if not isinstance(parsed, dict):
        return quote
    return (
        parsed.get("quote")
        or parsed.get("source_clause")
        or parsed.get("definition")
        or f"{parsed.get('name', '')}: {parsed.get('value', '')} {parsed.get('unit', '')}".strip(" :")
    )


def _fallback_document_id(context: Any) -> Optional[str]:
    from bson import ObjectId

    candidates = [
        str(context.contract_id) if context.contract_id else None,
        (context.displayed_document or {}).get("document_id"),
        *[str(item) for item in (context.selected_document_ids or [])],
    ]
    for candidate in candidates:
        if candidate and ObjectId.is_valid(candidate):
            return candidate
    return None


# ── Observations as a citation source ─────────────────────────────────────────


def observed_evidence(state: Any) -> List[str]:
    """Every piece of text the tools actually returned, normalized."""
    texts: List[str] = []
    for scratch in state.react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        candidates: List[Dict[str, Any]] = []
        if isinstance(observation.get("matches"), list):
            candidates.extend(item for item in observation["matches"] if isinstance(item, dict))
        if observation.get("snippet") or observation.get("quote") or observation.get("search_results"):
            candidates.append(observation)
        for candidate in candidates:
            for key in ("context", "quote", "snippet", "search_results", "text"):
                value = normalize_text(str(candidate.get(key) or ""))
                if value:
                    texts.append(value)
    return texts


def _observation_matches(state: Any) -> List[Dict[str, Any]]:
    """Flatten tool observations into a positional list of evidence dicts.

    Position matters: when the model writes `[2]` without a `<CITATIONS>` block,
    it is referring to the second snippet it was shown.
    """
    entries: List[Dict[str, Any]] = []
    for scratch in state.react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        if isinstance(observation.get("matches"), list):
            entries.extend(item for item in observation["matches"] if isinstance(item, dict))
        elif observation.get("snippet"):
            entries.append(observation)
    return entries


def citations_from_observations(
    state: Any,
    *,
    only_refs: Optional[Set[int]] = None,
    limit: int = 8,
) -> List[Dict[str, Any]]:
    """Build annotations directly from tool evidence.

    Used when the model wrote inline markers but no `<CITATIONS>` block. When
    `only_refs` is given, only the snippets at those positions are kept, so the
    model's `[2]` binds to the snippet it meant rather than pulling in every
    piece of evidence retrieved.
    """
    annotations: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str]] = set()

    for position, candidate in enumerate(_observation_matches(state), start=1):
        if only_refs is not None and position not in only_refs:
            continue
        quote = str(
            candidate.get("quote") or candidate.get("snippet") or candidate.get("context") or ""
        ).strip()
        if not quote:
            continue
        document_id = str(candidate.get("document_id") or candidate.get("doc_id") or "")
        key = (document_id, quote[:160])
        if key in seen:
            continue
        seen.add(key)

        evidence_id = candidate.get("evidence_id") or candidate.get("segment_id")
        annotations.append(
            {
                "type": "citation_data",
                "ref": position if only_refs is not None else len(annotations) + 1,
                "doc_id": document_id or None,
                "document_id": document_id or None,
                "filename": candidate.get("filename"),
                "page": candidate.get("page"),
                "page_start": candidate.get("page_start") or candidate.get("page"),
                "page_end": candidate.get("page_end"),
                "quote": quote[:MAX_QUOTE_CHARS],
                "evidence_id": evidence_id,
                "segment_id": evidence_id,
            }
        )
        if only_refs is None and len(annotations) >= limit:
            break
    return annotations


def enrich_from_observations(
    annotations: List[Dict[str, Any]],
    state: Any,
) -> List[Dict[str, Any]]:
    """Fill in the page and filename a model citation usually omits.

    Matches each citation to the observation it came from — by substring first,
    then by token overlap — and copies across provenance the model did not have.
    Never overwrites a value the model did supply.
    """
    if not annotations:
        return annotations

    entries: List[Dict[str, Any]] = []
    for candidate in _observation_matches(state):
        text = str(
            candidate.get("context") or candidate.get("snippet") or candidate.get("quote") or ""
        ).strip()
        if not text:
            continue
        entries.append(
            {
                "doc_id": str(candidate.get("document_id") or candidate.get("doc_id") or ""),
                "filename": candidate.get("filename"),
                "page": candidate.get("page"),
                "page_start": candidate.get("page_start") or candidate.get("page_number"),
                "page_end": candidate.get("page_end"),
                "quote": text,
            }
        )
    if not entries:
        return annotations

    by_document: Dict[str, List[Dict[str, Any]]] = {}
    for entry in entries:
        if entry["doc_id"]:
            by_document.setdefault(entry["doc_id"], []).append(entry)

    for item in annotations:
        quote = str(item.get("quote") or "").strip()
        document_id = str(item.get("doc_id") or item.get("document_id") or "")
        matched = _best_observation(quote, document_id, entries, by_document)

        if matched:
            _apply_page(item, matched, quote)
            if not item.get("filename"):
                item["filename"] = matched.get("filename")

        if item.get("page") is None and document_id:
            candidates = by_document.get(document_id, [])
            if candidates:
                best = next((entry for entry in candidates if entry.get("page") is not None), candidates[0])
                item["page"] = best["page"]
                if not item.get("filename"):
                    item["filename"] = best.get("filename")
                for key in ("quote", "text"):
                    if not item.get(key):
                        item[key] = best["quote"][:MAX_QUOTE_CHARS]

        if not item.get("quote") and document_id:
            candidates = by_document.get(document_id, [])
            if candidates:
                best = next((entry for entry in candidates if entry.get("page") is not None), candidates[0])
                snippet = best["quote"][:MAX_QUOTE_CHARS]
                item["quote"] = snippet
                item["text"] = snippet
                item["preview"] = snippet
                if item.get("page") is None and best.get("page") is not None:
                    item["page"] = best["page"]
                if not item.get("filename"):
                    item["filename"] = best.get("filename")
    return annotations


def _best_observation(
    quote: str,
    document_id: str,
    entries: List[Dict[str, Any]],
    by_document: Dict[str, List[Dict[str, Any]]],
) -> Optional[Dict[str, Any]]:
    if not quote:
        return None
    normalized = normalize_text(quote)
    tokens = set(content_tokens(normalized))

    candidates = by_document.get(document_id, [])
    if not candidates and document_id:
        candidates = [entry for entry in entries if entry["doc_id"] == document_id or not entry["doc_id"]]
    if not candidates:
        candidates = entries

    for entry in candidates:
        observed = normalize_text(entry["quote"])
        if normalized in observed or observed in normalized:
            return entry

    best: Optional[Dict[str, Any]] = None
    best_ratio = 0.0
    for entry in candidates:
        ratio = _overlap_ratio(tokens, normalize_text(entry["quote"]))
        if ratio >= SUPPORT_OVERLAP_RATIO and ratio > best_ratio:
            best_ratio = ratio
            best = entry
    return best


def _apply_page(item: Dict[str, Any], matched: Dict[str, Any], quote: str) -> None:
    page_start = matched.get("page_start")
    page_end = matched.get("page_end")

    # A chunk spanning several pages needs the quote's position interpolated, but
    # only when the annotation has no page of its own: the search result's page is
    # more reliable than interpolation when the text does not spread evenly.
    if page_start and page_end and page_end > page_start and item.get("page") is None:
        from services.contract_agent.graph.tools.executor import _estimate_page_for_quote

        item["page"] = _estimate_page_for_quote(
            matched["quote"], quote, page_start=page_start, page_end=page_end
        )
    elif matched.get("page") is not None and item.get("page") is None:
        item["page"] = matched["page"]

    if item.get("page") is None:
        page = page_from_text_markers(matched.get("quote") or "", quote)
        if page is not None:
            item["page"] = page
            item["page_start"] = page
            item["page_end"] = page


def page_from_text_markers(full_text: str, quote: str) -> Optional[int]:
    """Recover a page number from `--- Page N ---` markers preceding the quote."""
    if not full_text or not quote:
        return None
    haystack = re.sub(r"\s+", " ", full_text).lower()
    needle = re.sub(r"\s+", " ", quote).lower()

    position = haystack.find(needle)
    if position == -1:
        position = haystack.find(needle[:100])
    if position == -1:
        words = needle.split()
        if len(words) > 5:
            position = haystack.find(" ".join(words[:5]))
    if position == -1:
        return None

    prefix = haystack[:position]
    markers = list(re.finditer(r"-\s*-\s*-\s*page\s*(\d+)\s*-\s*-\s*-", prefix))
    if not markers:
        markers = list(re.finditer(r"(?:page\s*|\[\s*page\s*)(\d+)", prefix))
    return int(markers[-1].group(1)) if markers else None


# ── Step 3: validate against what the tools returned ─────────────────────────


def validate_citations(
    annotations: Sequence[Dict[str, Any]],
    state: Any,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Keep the citations that real evidence supports; stamp `verified` on each.

    Returns (kept, issues). A citation is dropped only when it is structurally
    unusable (no document, no quote) or a duplicate — an unsupported quote is
    KEPT but marked `verified: false`, so the UI can show the reader that the
    agent could not back it up. That flag is what the eval's citation-support
    metric counts, so it must reflect the check honestly.
    """
    evidence = observed_evidence(state)
    answer_tokens = set(content_tokens(state.answer))
    issues: List[str] = []
    kept: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str]] = set()

    # No tool observations at all means the model answered from its prompt
    # context. There is nothing to check against, so citations pass through
    # flagged rather than being discarded.
    no_evidence = not evidence

    for annotation in annotations:
        quote = str(annotation.get("quote") or "").strip()
        document_id = str(annotation.get("doc_id") or annotation.get("document_id") or "").strip()
        if not document_id:
            issues.append("invalid_citation_missing_document_id")
            continue
        if not quote:
            issues.append("invalid_citation_missing_quote")
            continue

        normalized = normalize_text(quote)
        tokens = set(content_tokens(normalized))

        if no_evidence:
            supported = True
            issues.append("citation_no_evidence_passthrough")
        elif not tokens:
            supported = False
        else:
            supported = any(_supports(normalized, tokens, item) for item in evidence)

        if not supported:
            issues.append("invalid_or_unsupported_citation")

        dedupe_key = (document_id, normalized[:180])
        if dedupe_key in seen:
            issues.append("duplicate_citation_removed")
            continue
        seen.add(dedupe_key)

        cleaned = dict(annotation)
        cleaned["verified"] = supported
        # Preserve the pre-renumbering ref so a consumer can trace a displayed
        # citation back to what the model originally wrote.
        cleaned["source_ref"] = annotation.get("ref")

        if len(quote) > MAX_QUOTE_CHARS:
            cleaned["quote"] = quote[:MAX_QUOTE_CHARS].rsplit(" ", 1)[0].rstrip() + " ..."
            issues.append("broad_citation_trimmed")

        quote_tokens = set(content_tokens(cleaned.get("quote") or ""))
        if answer_tokens and quote_tokens and not (answer_tokens & quote_tokens):
            issues.append("weak_claim_citation_overlap")

        kept.append(cleaned)

    return kept, list(dict.fromkeys(issues))


# ── Step 4: renumber, producing the map step 5 needs ─────────────────────────


def renumber(annotations: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[int, int]]:
    """Assign contiguous refs from 1 and return {current_ref: new_ref}.

    The map is the whole point — renumbering used to happen without one, so the
    prose kept pointing at pre-validation numbers.

    The map is keyed on each annotation's CURRENT ref, not its original
    `source_ref`. This function can run more than once (validation drops some
    citations, then dropping unreferenced ones can leave another gap), and by the
    second call the prose is already in the first call's numbering. Keying on
    `source_ref` would hand the second call a map from the model's original
    numbers, which no longer appear in the text.

    `source_ref` is set once, on the first renumbering, and preserved after that
    so a displayed citation stays traceable to what the model wrote.
    """
    ref_map: Dict[int, int] = {}
    for position, annotation in enumerate(annotations, start=1):
        try:
            current_ref = int(annotation.get("ref"))
        except (TypeError, ValueError):
            current_ref = None
        if "source_ref" not in annotation or annotation.get("source_ref") is None:
            annotation["source_ref"] = current_ref
        annotation["ref"] = position
        if current_ref is not None and current_ref not in ref_map:
            ref_map[current_ref] = position
    return annotations, ref_map


# ── Step 5: rewrite the markers in the prose. Last, always. ──────────────────


def rewrite_markers(
    answer: str,
    annotations: Sequence[Dict[str, Any]],
    *,
    ref_map: Optional[Dict[int, int]] = None,
    react_scratchpad: Sequence[Dict[str, Any]] = (),
    drop_unmapped: bool = True,
) -> str:
    """Point every inline marker at its final citation number.

    Handles the three shapes a model produces: a bare `[N]`, a document-prefixed
    `[doc-0 #2]`, and an opaque `[<segment-id>]`.

    A marker whose citation did not survive validation is REMOVED, not left in
    place. Leaving it would collide with a survivor that renumbered into the same
    slot: drop citation 2 of three and `[3]` becomes `[2]`, so a stale `[2]`
    would sit next to the remapped one and both would resolve to the same
    evidence. Removing it is also the honest result — there is no source behind
    that claim any more.

    Pass `drop_unmapped=False` when the map is known to be partial and the
    unmapped markers are still meaningful.
    """
    if not answer or not annotations:
        return answer

    ref_map = dict(ref_map or {})
    id_to_ref: Dict[str, str] = {}
    position_to_ref: Dict[int, str] = {}

    for annotation in annotations:
        ref = annotation.get("ref")
        if not ref:
            continue
        ref_text = str(ref)

        # Deliberately NOT inferring a mapping from source_ref here. On a second
        # rewrite the prose is already in the previous pass's numbering, so a
        # source_ref-derived entry would map numbers that no longer appear in the
        # text — and would drop the ones that do. The caller's ref_map is the only
        # authority.

        for key in ("segment_id", "evidence_id", "source_id", "id"):
            value = annotation.get(key)
            if value:
                id_to_ref[str(value).strip()] = ref_text

        for position in _observation_positions_for(annotation, react_scratchpad):
            position_to_ref[position] = ref_text

    def replace_doc_marker(match: "re.Match[str]") -> str:
        try:
            position = int(match.group(1))
        except (TypeError, ValueError):
            return match.group(0)
        ref = position_to_ref.get(position)
        return f"[{ref}]" if ref else match.group(0)

    final_refs = {
        int(item["ref"]) for item in annotations if str(item.get("ref") or "").isdigit()
    }

    def replace_numeric_marker(match: "re.Match[str]") -> str:
        try:
            value = int(match.group(1))
        except (TypeError, ValueError):
            return match.group(0)
        mapped = ref_map.get(value)
        if mapped:
            return f"[{mapped}]"
        # Not in the map. Either it is already a final ref (the map was a no-op
        # for it) or its citation is gone.
        if value in final_refs and value not in ref_map.values():
            return match.group(0)
        if drop_unmapped and ref_map:
            return _DROP_MARKER
        return match.group(0)

    def replace_id_marker(match: "re.Match[str]") -> str:
        ref = id_to_ref.get(match.group(1).strip())
        return f"[{ref}]" if ref else match.group(0)

    answer = DOC_MARKER_RE.sub(replace_doc_marker, answer)
    # One pass, so a marker rewritten to [2] is never re-read and rewritten again.
    answer = MARKER_RE.sub(replace_numeric_marker, answer)
    if id_to_ref:
        answer = ID_MARKER_RE.sub(replace_id_marker, answer)
    return _clean_dropped_markers(answer)


#: Placeholder for a marker being removed. Substituted in the same single pass as
#: the rewrites, then swept up with any whitespace it orphaned — doing the removal
#: inline would let a later pattern match across the hole it left.
_DROP_MARKER = "\x00drop\x00"


def _clean_dropped_markers(answer: str) -> str:
    if _DROP_MARKER not in answer:
        return answer
    # Take the space in front of the marker with it, so "notice [2]." becomes
    # "notice." rather than "notice .".
    answer = re.sub(r"[ \t]*" + re.escape(_DROP_MARKER), "", answer)
    return re.sub(r"[ \t]{2,}", " ", answer)


def _observation_positions_for(
    annotation: Dict[str, Any],
    react_scratchpad: Sequence[Dict[str, Any]],
) -> List[int]:
    """Positions in the tool evidence that this annotation corresponds to.

    Matched by evidence id first — immune to index drift — then by quote overlap.
    """
    positions: List[int] = []
    annotation_id = str(annotation.get("evidence_id") or annotation.get("segment_id") or "").strip()
    quote = normalize_text(annotation.get("quote") or "")
    tokens = set(content_tokens(quote)) if quote else set()

    for scratch in react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        matches = observation.get("matches")
        if not isinstance(matches, list):
            continue
        for position, match in enumerate(matches, start=1):
            if not isinstance(match, dict):
                continue
            if annotation_id:
                match_id = str(match.get("evidence_id") or match.get("segment_id") or "").strip()
                if match_id and match_id == annotation_id:
                    positions.append(position)
                    continue
            if not quote:
                continue
            for key in ("context", "quote", "snippet", "text"):
                observed = normalize_text(str(match.get(key) or ""))
                if observed and _supports(quote, tokens, observed):
                    positions.append(position)
                    break
    return positions


def drop_unused_annotations(
    answer: str,
    annotations: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Remove citations the prose never actually references.

    The model sometimes lists a citation it did not use, and the observation
    fallback can build more than the prose needs. Surfacing those would show the
    reader sources the answer does not rest on.
    """
    used = used_refs(answer)
    if not used:
        return list(annotations)
    return [item for item in annotations if item.get("ref") in used]


def ensure_inline_marker(answer: str, annotations: Sequence[Dict[str, Any]]) -> str:
    """Attach a marker to the first prose line when the answer cites nothing inline."""
    if not answer or not annotations or MARKER_RE.search(answer):
        return answer
    if is_unsupported_or_refusal(answer):
        return answer

    refs = [int(item["ref"]) for item in annotations if str(item.get("ref") or "").isdigit()]
    if not refs:
        return answer
    marker = f"[{min(refs)}]"

    lines = answer.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "-", "*", "<", "|")):
            continue
        if stripped.lower().startswith("**confidence"):
            continue
        lines[index] = line.rstrip() + f" {marker}"
        return "\n".join(lines)
    return answer.rstrip() + f" {marker}"


def is_unsupported_or_refusal(answer: str) -> bool:
    """Answers that decline are exempt from needing a citation."""
    normalized = " ".join((answer or "").lower().split())
    return any(
        phrase in normalized
        for phrase in (
            "does not contain",
            "did not find",
            "not found",
            "no evidence",
            "insufficient evidence",
            "cannot answer",
            "can't answer",
            "cannot perform",
            "can't perform",
            "i cannot help",
            "i can't help",
            "requires human approval",
            "requires approval",
        )
    )


# ── Presentation ──────────────────────────────────────────────────────────────


def build_citation_details(
    annotations: Sequence[Dict[str, Any]],
    *,
    style: str,
    segment_type: str,
) -> Dict[str, Any]:
    return {
        "annotations": list(annotations),
        "cited_segments": [
            {
                "id": item.get("segment_id") or f"{segment_type}-{index}",
                "text": item.get("quote", ""),
                "quote": item.get("quote", ""),
                "preview": item.get("quote", ""),
                "page": item.get("page"),
                "page_number": item.get("page"),
                "page_start": item.get("page_start") or item.get("page"),
                "page_end": item.get("page_end"),
                "contract_id": item.get("doc_id"),
                "contract_name": item.get("filename"),
                "type": segment_type,
                # Default False, not True: an annotation that has not been through
                # validate_citations has not been checked, and claiming otherwise
                # is the failure mode this whole module exists to prevent.
                "verified": item.get("verified", False),
            }
            for index, item in enumerate(annotations, start=1)
        ],
        "citation_style": style,
    }


# ── The two entry points ──────────────────────────────────────────────────────


def resolve_for_answer(answer: str, state: Any) -> Tuple[str, List[Dict[str, Any]], str]:
    """Steps 1-2: parse, resolve, enrich. Called while finishing the answer.

    Returns (answer_without_the_block, annotations, style). Markers are NOT
    rewritten here — validation has not run yet, so the final numbering is not
    known. `validate_and_finalize` does that.
    """
    answer = normalize_markers(answer or "")

    raw = parse_citation_block(answer)
    if raw:
        clean = strip_citation_block(answer)
        resolved = resolve_citations(raw, state)
        # Drop citations the prose never references before doing the work of
        # enriching them.
        used = used_refs(clean)
        if used:
            resolved = [item for item in resolved if item.get("ref") in used]
        if resolved:
            return clean, enrich_from_observations(resolved, state), "model_citations"
        answer = clean

    # No usable block. If the model wrote markers anyway, bind them to the
    # evidence positions they refer to.
    clean = strip_citation_block(answer)
    marker_refs = used_refs(clean)
    if marker_refs:
        from_observations = citations_from_observations(state, only_refs=marker_refs)
        if from_observations:
            renumbered, ref_map = renumber(from_observations)
            return (
                rewrite_markers(clean, renumbered, ref_map=ref_map),
                renumbered,
                "model_markers_bound_to_observations",
            )

    return clean, [], "none"


def validate_and_finalize(state: Any) -> Dict[str, Any]:
    """Steps 3-5: validate, renumber, then rewrite the markers.

    Mutates `state.answer`, `state.citation_annotations` and
    `state.citation_details`. Returns the guard report for the trace.

    This is the fix for F-05: rewriting comes after renumbering, and renumbering
    comes after validation, so dropping a citation cannot leave the prose
    pointing at the wrong evidence.
    """
    annotations = list(state.citation_annotations or [])

    if not annotations:
        # The model cited nothing inline. Fall back to observed evidence so an
        # evidence-backed answer still shows its sources.
        fallback = citations_from_observations(state)
        if fallback:
            annotations = enrich_from_observations(fallback, state)
            state.answer = rewrite_markers(
                state.answer, annotations, react_scratchpad=state.react_scratchpad
            )
            annotations = drop_unused_annotations(state.answer, annotations)

    kept, issues = validate_citations(annotations, state)
    kept, ref_map = renumber(kept)

    # Markers last.
    state.answer = rewrite_markers(
        state.answer, kept, ref_map=ref_map, react_scratchpad=state.react_scratchpad
    )
    kept = drop_unused_annotations(state.answer, kept)
    # Dropping unused annotations can leave a gap in the numbering, so renumber
    # once more and re-point the prose. Converges after one pass because the
    # second renumbering only ever compacts.
    if kept:
        kept, second_map = renumber(kept)
        if any(old != new for old, new in second_map.items()):
            state.answer = rewrite_markers(state.answer, kept, ref_map=second_map)

    style = (state.citation_details or {}).get("citation_style") or "react_tool_observation"
    segment_type = "model_citation" if style == "model_citations" else "tool_observation"

    state.citation_annotations = kept
    if kept:
        state.answer = ensure_inline_marker(state.answer, kept)
        details = build_citation_details(kept, style=style, segment_type=segment_type)
    else:
        details = {"annotations": [], "cited_segments": [], "citation_style": style}

    report = {"annotations": kept, "issues": issues}
    details["citation_guard"] = report
    state.citation_details = {**(state.citation_details or {}), **details}
    return report
