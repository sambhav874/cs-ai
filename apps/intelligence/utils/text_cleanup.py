import html
import re
from typing import Any, Dict, List, Optional



_HTML_BREAK_RE = re.compile(r"(?:&lt;|<)\s*br\s*/?\s*(?:&gt;|>)", re.IGNORECASE)
_MOJIBAKE_HINTS = (
    "â€",
    "â€¢",
    "â€\"",
    "â€\"",
    "â€˜",
    "â€™",
    "â€œ",
    "â€\u009d",
    "â‰",
    "â¯",
    "Â",
    "Ã",
)

_MOJIBAKE_REPLACEMENTS = (
    # Bullets and list markers
    ("â€¢", "•"),
    # Dashes
    ("â€\"", "–"),
    ("â€\"", "—"),
    ("â€•", "—"),
    ("â€\"", "—"),
    # Quotes
    ("â€˜", "'"),
    ("â€™", "'"),
    ("â€š", ","),
    ("â€œ", '"'),
    ("â€\u009d", '"'),
    # Ellipsis and angle quotes
    ("â€¦", "..."),
    ("â€º", ">"),
    ("â€¹", "<"),
    # Mathematical / comparison operators
    ("â‰¤", "≤"),
    ("â‰¥", "≥"),
    ("â‰ ", "≠"),
    ("â‰ˆ", "≈"),
    ("Ã—", "×"),
    ("Ã·", "÷"),
    # Spaces (narrow no-break space, figure space, etc.) — normalize to regular space
    ("â¯", " "),
    ("â€‰", " "),
    ("â€¯", " "),
    ("â€ƒ", " "),
    ("â€‚", " "),
    # Symbols
    ("â„¢", "™"),
    ("â€", "—"),
    # Accented Latin characters (Ã + continuation byte = common mojibake)
    ("Ã©", "é"),
    ("Ã¨", "è"),
    ("Ã¡", "á"),
    ("Ã\u00a0", "à"),
    ("Ã¶", "ö"),
    ("Ã¼", "ü"),
    ("Ã±", "ñ"),
    ("Ã§", "ç"),
    ("Ãª", "ê"),
    ("Ã®", "î"),
    ("Ã¢", "â"),
    ("Ã´", "ô"),
    ("Ã»", "û"),
    ("Ã¤", "ä"),
    # Â-prefixed Latin-1 symbols (must come after multi-char Â patterns)
    ("Â®", "®"),
    ("Â©", "©"),
    ("Â·", "·"),
    ("Â£", "£"),
    ("Â¥", "¥"),
    ("Â§", "§"),
    ("Â¶", "¶"),
    ("Â°", "°"),
    ("Â½", "½"),
    ("Â¼", "¼"),
    ("Â¾", "¾"),
    ("Â¹", "¹"),
    ("Â²", "²"),
    ("Â³", "³"),
    ("Âº", "º"),
    ("Âª", "ª"),
    ("Â¬", "¬"),
    ("Â±", "±"),
    ("Â¯", " "),
    ("Â\u00a0", " "),
    # Bare Â (leading byte of 2-byte UTF-8 for U+0080..U+00FF) — strip last
    ("Â", ""),
)

_MONTH_NAMES = {
    "jan": "January",
    "january": "January",
    "feb": "February",
    "february": "February",
    "mar": "March",
    "march": "March",
    "apr": "April",
    "april": "April",
    "may": "May",
    "jun": "June",
    "june": "June",
    "jul": "July",
    "july": "July",
    "aug": "August",
    "august": "August",
    "sep": "September",
    "sept": "September",
    "september": "September",
    "oct": "October",
    "october": "October",
    "nov": "November",
    "november": "November",
    "dec": "December",
    "december": "December",
}


def _mojibake_score(text: str) -> int:
    return sum(text.count(token) for token in _MOJIBAKE_HINTS)


def _repair_cp1252_mojibake(text: str) -> str:
    if not any(token in text for token in _MOJIBAKE_HINTS):
        return text

    current_score = _mojibake_score(text)
    if current_score == 0:
        return text

    # Try cp1252 re-encoding first (most common PDF extraction path),
    # then latin-1 as a fallback.
    best = text
    for encoding in ("cp1252", "latin-1"):
        try:
            candidate = text.encode(encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if not candidate:
            continue
        candidate_score = _mojibake_score(candidate)
        length_ratio = len(candidate) / max(len(text), 1)
        if candidate_score < current_score and length_ratio > 0.8:
            best = candidate
            current_score = candidate_score
            if current_score == 0:
                break

    return best


# Regex to catch orphaned continuation bytes left behind when the leading
# Â (0xC2) byte is stripped independently.  E.g. "â ¤" from a stripped "â‰¤".
_ORPHAN_CONTINUATION_BYTE_RE = re.compile(
    r"â\s*[\x80-\xbf¡¢£¤¥¦§¨©ª«¬\xad®¯°±²³´µ¶·¸¹º»¼½¾¿]"
)


def clean_text_encoding(text: str) -> str:
    """Repair common PDF/HTML extraction mojibake before indexing or display."""
    if not text:
        return text

    cleaned = str(text).replace("\r\n", "\n").replace("\r", "\n")
    cleaned = html.unescape(cleaned)
    cleaned = _HTML_BREAK_RE.sub("\n", cleaned)
    cleaned = _repair_cp1252_mojibake(cleaned)
    cleaned = html.unescape(cleaned)
    cleaned = _HTML_BREAK_RE.sub("\n", cleaned)

    for bad, good in _MOJIBAKE_REPLACEMENTS:
        cleaned = cleaned.replace(bad, good)

    cleaned = re.sub(r"([A-Za-z])â€\s*s\b", r"\1's", cleaned)
    cleaned = re.sub(r"([A-Za-z])â€\s*t\b", r"\1't", cleaned)
    cleaned = re.sub(r"\b([Ee]arn)â€\s*out\b", r"\1-out", cleaned)
    cleaned = re.sub(r"\b([Cc]law)â€\s*back\b", r"\1back", cleaned)
    cleaned = re.sub(r"ã\s*(\d+)\s*ã", r"[\1]", cleaned)
    cleaned = cleaned.translate({
        0x0085: "...",
        0x0091: "'",
        0x0092: "'",
        0x0093: '"',
        0x0094: '"',
        0x0096: "-",
        0x0097: "-",
        0x009C: '"',
        0x009D: '"',
    })

    # In already-sanitized text, the final byte of a mojibake sequence is often
    # gone. Treat `â€` beside whitespace as a damaged space, otherwise as a dash.
    cleaned = re.sub(r"â€(?=\s)", " ", cleaned)
    cleaned = re.sub(r"(?<=\s)â€(?=\S)", " ", cleaned)
    cleaned = cleaned.replace("â€", "-")

    # Clean orphaned continuation bytes (e.g. "â ¤" left after partial Â stripping)
    cleaned = _ORPHAN_CONTINUATION_BYTE_RE.sub(" ", cleaned)
    # Remove any remaining isolated â that don't form a valid character
    cleaned = re.sub(r"â(?=[\s\d])", " ", cleaned)

    cleaned = cleaned.replace("\ufeff", "").replace("\u00a0", " ")
    cleaned = re.sub(r"[\u2000-\u200a\u2028-\u202f\u205f\u3000]", " ", cleaned)
    cleaned = re.sub(r"[ \t\f\v]+", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    def expand_month_day(match: re.Match) -> str:
        month = _MONTH_NAMES.get(match.group(1).lower(), match.group(1))
        return f"{month} {match.group(2)}"

    month_pattern = r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[- ]?(\d{1,2})\b"
    cleaned = re.sub(month_pattern, expand_month_day, cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def get_formatted_citations(
    citation_details: Any,
    existing_annotations: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Format citations to show the actual chunks/quotes that were cited.

    Matches the formatting and fallback logic used in run_llm_qa.py,
    while preserving other keys in the annotations to avoid test regressions.
    """
    if not isinstance(citation_details, dict):
        citation_details = {}
    citations_list = []

    # Try annotations from citation_details first, or fall back to existing_annotations
    annotations = citation_details.get("annotations") or existing_annotations or []
    for ann in annotations:
        if isinstance(ann, dict):
            ann_copy = dict(ann)
            ann_copy["quote"] = ann_copy.get("quote") or ann_copy.get("text") or ""
            ann_copy["page"] = ann_copy.get("page") or ann_copy.get("page_number")
            citations_list.append(ann_copy)

    if not citations_list and citation_details.get("cited_segments"):
        for index, seg in enumerate(citation_details["cited_segments"], start=1):
            if isinstance(seg, dict):
                seg_copy = dict(seg)
                seg_copy["ref"] = index
                seg_copy["quote"] = seg_copy.get("quote") or seg_copy.get("text") or ""
                seg_copy["page"] = seg_copy.get("page") or seg_copy.get("page_number")
                citations_list.append(seg_copy)
    return citations_list

