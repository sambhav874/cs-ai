"""Key terms, clauses and a summary for one contract, each value with a quote
that is really in the contract.

This replaces draftLegal's review agent. It keeps that agent's field model
(the key terms, clause flags, type-specific and org-defined fields, open-ended
findings, the clause taxonomy, the risk score and summary) and holds every
record to ContractSense's rule: a value is stored with a verbatim quote found
in the source, or it is reported absent. Nothing is defaulted — no guessed
currency, no guessed jurisdiction.

What changed from the review agent, and why:
  • Quotes are checked against the source (services/quote_locator.py). The
    review agent asked for quotes and stored whatever came back.
  • Clauses are located, not copied. The model names each clause's first and
    last words; the stored text is the contract's own span between them, with
    its page. A clause whose anchors are not in the text is dropped and
    counted, never stored as the model's paraphrase.
  • Types are normalised in code (dates, amounts, booleans), not by a second
    "validate" model call, so the rules cannot drift with a prompt.
  • Every record carries the page it came from, when the text has pages.

`extract_key_terms` takes the model call as a function, so the whole
pipeline — verification, normalisation, merging, the ledger — is tested
without a model.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Dict, List, Optional, Tuple

from services.key_terms_schema import (
    CLAUSE_TYPE_GUIDE,
    CONTRACT_TYPE_GUIDE,
    CONTRACT_TYPES,
    TYPE_SCHEMAS,
)
from services.platform_models import PlatformCostCapExceeded
from services.quote_locator import SourceText, Span

logger = logging.getLogger(__name__)

# (system prompt, user content) -> the model's raw text.
Invoke = Callable[[str, str], str]


@dataclass(frozen=True)
class FieldSpec:
    name: str
    kind: str  # date | number | integer | currency | text | boolean
    hint: str


FIELDS: Tuple[FieldSpec, ...] = (
    FieldSpec("effectiveDate", "date", "date the contract takes effect"),
    FieldSpec("expiryDate", "date", "date the contract ends, if a fixed date or computable from a stated term"),
    FieldSpec("value", "number", "total contract value"),
    FieldSpec("currency", "currency", "ISO 4217 code of the contract value, only if the contract states it"),
    FieldSpec("governingLaw", "text", "governing law / jurisdiction, only if the contract states it"),
    FieldSpec("noticePeriodDays", "integer", "notice period in days (for termination or non-renewal)"),
    FieldSpec("paymentTermsDays", "integer", "days to pay an invoice"),
    FieldSpec("autoRenew", "boolean", "does the contract renew automatically"),
    FieldSpec("exclusivity", "boolean", "is there an exclusivity obligation"),
    FieldSpec("liabilityCapAmount", "number", "liability cap amount"),
    FieldSpec("ipOwnership", "text", "who owns IP created under the contract, briefly"),
    FieldSpec("terminationRights", "text", "who may terminate and on what grounds, briefly"),
    FieldSpec("confidentiality", "boolean", "is there a confidentiality obligation"),
)
FIELD_BY_NAME = {f.name: f for f in FIELDS}

CLAUSE_FLAGS = (
    "forceMajeure", "mfn", "changeOfControl", "auditRights", "assignmentRestriction",
    "limitationOfLiability", "indemnification", "warrantyDisclaimer",
)
RISK_RATINGS = frozenset({"favorable", "unfavorable", "neutral", "unusual"})
_CLAUSE_TYPES = frozenset(
    m.group(1) for m in re.finditer(r"^\s+([a-z_]+)\s+—", CLAUSE_TYPE_GUIDE, re.MULTILINE)
)

# Fields the second, focused pass looks for when the first pass missed them.
RECOVERY_FIELDS = ("effectiveDate", "expiryDate", "governingLaw", "value")

FIELD_CHUNK = 120_000     # chars per fields call; most contracts fit in one
FIELD_OVERLAP = 6_000
CLAUSE_CHUNK = 40_000     # smaller: the clause list is the long answer
CLAUSE_OVERLAP = 2_000
MAX_CLAUSE_CHARS = 6_000
MAX_CLAUSES = 300
MAX_TEXT = 1_000
UNVERIFIED_VALUE_CONFIDENCE = 0.6  # value not visible in its own quote

# Reasons a term is reported absent. Each one is a different next step for a
# reviewer, which is why they are kept apart.
NOT_STATED = "not_stated"            # the model found nothing
NO_QUOTE = "no_quote"                # a value with nothing to check it against
QUOTE_NOT_FOUND = "quote_not_found"  # the quote is not in the contract
UNREADABLE = "unreadable_value"      # a quote, but a value of the wrong type


class KeyTermExtractionFailed(RuntimeError):
    """No model call succeeded; there is nothing to report."""


class NoProviderConfigured(RuntimeError):
    """No model is configured for this org or this tier. Not a failure of the
    contract: the run is reported as skipped, and a retry after an admin adds
    a key will work."""


# ─── Prompts ─────────────────────────────────────────────────────────────────

_RULES = """Rules that decide whether your answer is kept:
- Every value must come with "quote": text copied EXACTLY from the contract,
  character for character, long enough to identify one place (a clause, a
  sentence or a table row). Answers whose quote is not in the contract are
  discarded.
- If the contract does not state something, return null. Never infer a value
  the text does not state: no currency from a country, no governing law from
  an address, no dates from today's date.
- Dates as YYYY-MM-DD. Numbers as plain numbers. Booleans as true/false."""


def _fields_prompt(contract_type: Optional[str], custom_fields: List[Dict[str, Any]]) -> str:
    spec = {f.name: f"{f.kind}: {f.hint}" for f in FIELDS}
    lines = [
        "You extract key terms from a contract. Return ONLY a JSON object, no markdown:",
        "{",
        '  "fields": { "<fieldName>": { "value": <value or null>, "quote": "<exact text or null>",'
        ' "section": "<e.g. Section 5.2 or null>", "confidence": <0.0-1.0> } },',
        '  "parties": [ { "role": "<Client|Vendor|Licensor|...>", "name": "<party name>", "quote": "<exact text>" } ],',
        '  "clauseFlags": { ' + ", ".join(f'"{f}": <true|false>' for f in CLAUSE_FLAGS) + " },",
        '  "openEndedFindings": [ { "key": "<snake_case>", "label": "<human readable>", "value": <value>,'
        ' "quote": "<exact text>", "confidence": <0.0-1.0> } ]',
        "}",
        "",
        "Fields:",
        json.dumps(spec, indent=2),
        "",
        "openEndedFindings: other legally significant terms the fields do not cover"
        " (unusual penalties, bespoke triggers, non-standard carve-outs). At most 15.",
        "",
        _RULES,
    ]
    type_schema = TYPE_SCHEMAS.get((contract_type or "").upper(), [])
    if contract_type:
        lines.append(f"\nThis is a {contract_type} contract.")
    if type_schema:
        lines.append(
            f'Also return "typeFields": {{ "<key>": {{ "value", "quote", "confidence" }} }} for these'
            f" fields standard for a {contract_type}:"
        )
        lines.append(json.dumps(type_schema, indent=2))
    if custom_fields:
        lines.append(
            'Also return "customFields": { "<key>": { "value", "quote", "confidence" } } for these'
            " organisation-defined fields:"
        )
        lines.append(json.dumps([
            {"key": f.get("fieldKey"), "label": f.get("fieldLabel"), "type": f.get("fieldType"),
             "options": f.get("options") or [], "hint": f.get("helpText") or ""}
            for f in custom_fields
        ], indent=2))
    return "\n".join(lines)


_CLAUSES_PROMPT = """You segment a contract into its significant clauses. Return ONLY a JSON object, no markdown:
{
  "clauses": [
    {
      "clauseType": "<type from the list below>",
      "start": "<the clause's first 8-15 words, copied EXACTLY>",
      "end": "<the clause's last 8-15 words, copied EXACTLY>",
      "interpretation": "<1-2 plain-English sentences: what the clause means and what it obliges each party to do>",
      "riskRating": "<favorable|unfavorable|neutral|unusual>",
      "sectionRef": "<e.g. Section 5.2 or Article III, or null>"
    }
  ]
}

Do not copy the clause itself: give its first and last words, exactly as written,
and the clause is read from the contract between them. A clause whose words
cannot be found is discarded.

Extract ALL significant clauses, not one per type: a contract may have several
termination or payment clauses. Skip headings, signature blocks and the table
of contents.

""" + CLAUSE_TYPE_GUIDE + """
Risk rating:
  favorable   — benefits the uploading party: high liability caps, narrow indemnity, strong IP retention, long cure periods, easy termination rights
  unfavorable — burdens the uploading party: uncapped liability, broad indemnity, one-sided IP assignment, auto-renewal with short opt-out, short cure periods
  neutral     — standard boilerplate with balanced obligations
  unusual     — non-standard, unexpected, or bespoke clause for this contract type
"""

_SCORE_PROMPT = """You are a contract risk and classification specialist. From the verified terms and
clause text below, return ONLY a JSON object, no markdown:
{
  "contractType": "<NDA|MSA|SOW|SLA|VENDOR_AGREEMENT|EMPLOYMENT|PARTNERSHIP|LICENSE|DATA_PROCESSING|ORDER_FORM|OTHER>",
  "suggestedTitle": "<concise title from party names + contract type, max 80 chars>",
  "summary": "<2-3 sentences: what the contract does, who the parties are, its key terms>",
  "riskScore": <0.0-1.0, 1.0 is highest risk>,
  "riskFactors": ["<brief risk factor>"]
}
Say only what the terms and clauses below support.

""" + CONTRACT_TYPE_GUIDE + """
─── Risk factors ────────────────────────────────────────────────────────
Consider: unlimited liability, no liability cap, broad indemnification, IP
assignment to counterparty, auto-renewal with short opt-out window, long notice
period, no audit rights, restrictive assignment, MFN obligations.
"""


def _recovery_prompt(missing: List[str]) -> str:
    spec = {name: f"{FIELD_BY_NAME[name].kind}: {FIELD_BY_NAME[name].hint}" for name in missing}
    return (
        "A first pass over this contract did not find these fields. Read it again and return ONLY a JSON "
        'object { "fields": { "<fieldName>": { "value", "quote", "section", "confidence" } } } for exactly '
        "these fields:\n" + json.dumps(spec, indent=2) + "\n\n" + _RULES
    )


def _wrap(text: str, what: str) -> str:
    from agents_service.untrusted import wrap_untrusted_document

    return wrap_untrusted_document(text, source=what)


# ─── Parsing and normalising ─────────────────────────────────────────────────

def parse_json_object(content: Any) -> Dict[str, Any]:
    """The first JSON object in a model's reply, or {}."""
    if isinstance(content, list):  # content blocks
        content = " ".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    text = str(content or "").strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    for candidate in (text, text[text.find("{"): text.rfind("}") + 1] if "{" in text else ""):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):  # a one-element array around the object
            data = next((d for d in data if isinstance(d, dict)), {})
        return data if isinstance(data, dict) else {}
    return {}


def _dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip().lower() in {"", "null", "none", "n/a", "unknown", "not specified"}) or value == []


_SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "mm": 1e6, "million": 1e6, "bn": 1e9, "b": 1e9, "billion": 1e9}


def to_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value == value else None
    text = str(value).strip().lower().replace(",", "")
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*(thousand|million|billion|bn|mm|k|m|b)?\b", text)
    if not match:
        return None
    return float(match.group(1)) * _SCALE.get(match.group(2) or "", 1.0)


def to_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    iso = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?", text)
    try:
        if iso:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3))).isoformat()
        # A written month is unambiguous; a bare 03/04/2025 is not, and a
        # wrong guess is worse than an absent date.
        if re.search(r"[A-Za-z]{3,}", text):
            from dateutil import parser as date_parser

            return date_parser.parse(text, fuzzy=False).date().isoformat()
    except (ValueError, OverflowError):
        return None
    return None


def to_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"true", "yes", "y"}:
        return True
    if text in {"false", "no", "n"}:
        return False
    return None


def normalize_value(kind: str, value: Any) -> Any:
    """The value in its declared type, or None if it cannot be read as one."""
    if kind == "date":
        return to_date(value)
    if kind == "number":
        return to_number(value)
    if kind == "integer":
        number = to_number(value)
        return int(number) if number is not None and number == int(number) else None
    if kind == "currency":
        text = str(value).strip().upper()
        return text if re.fullmatch(r"[A-Z]{3}", text) else None
    if kind == "boolean":
        return to_bool(value)
    if isinstance(value, list) and all(isinstance(v, (str, int, float)) for v in value):
        value = ", ".join(str(v) for v in value)  # a multi-select answer
    if isinstance(value, (dict, list)):
        return None
    text = str(value).strip()
    return text[:MAX_TEXT] if text else None


def _number_forms(value: float) -> List[str]:
    forms = []
    for divisor in (1, 1e3, 1e6, 1e9):
        scaled = value / divisor
        if scaled >= 1 or divisor == 1:
            forms.append(f"{scaled:.2f}".rstrip("0").rstrip("."))
    return forms


def value_visible_in_quote(kind: str, value: Any, quote: str) -> bool:
    """Is a numeric value actually written in its quote?

    "30" in "within thirty (30) days" is; 45 in "within 30 days" is not. A
    quote with no digits at all ("thirty days") gets the benefit of the doubt:
    words are not checked, only digits that contradict.
    """
    if kind not in {"number", "integer"} or value is None:
        return True
    digits = re.sub(r"(?<=\d),(?=\d{3})", "", quote)
    written = re.findall(r"\d+(?:\.\d+)?", digits)
    if not written:
        return True
    forms = set(_number_forms(float(value)))
    return any(w.rstrip("0").rstrip(".") in forms or w in forms for w in written)


def _confidence(raw: Any, default: float = 0.8) -> float:
    number = to_number(raw)
    if number is None:
        return default
    if number > 1:
        number /= 100
    return round(max(0.0, min(1.0, number)), 2)


# ─── Verification ────────────────────────────────────────────────────────────

def _located(source: SourceText, span: Span) -> Dict[str, Any]:
    page, page_end = source.pages(span)
    return {"page": page, "pageEnd": page_end, "spanStart": span.start, "spanEnd": span.end}


def verify_term(kind: str, candidates: List[Dict[str, Any]], source: SourceText) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """The first candidate whose value reads and whose quote is in the source.

    Returns (record, None) or (None, reason absent). The reason is the most
    informative failure across candidates: a quote that was not found says
    more than a field nobody stated.
    """
    reason = NOT_STATED
    rank = {NOT_STATED: 0, NO_QUOTE: 1, UNREADABLE: 2, QUOTE_NOT_FOUND: 3}
    for raw in candidates:
        raw = _dict(raw)
        if _is_blank(raw.get("value")):
            continue
        value = normalize_value(kind, raw.get("value"))
        quote = raw.get("quote")
        failure = None
        if _is_blank(quote):
            failure = NO_QUOTE
        elif value is None:
            failure = UNREADABLE
        else:
            span = source.locate(str(quote))
            if span is None:
                failure = QUOTE_NOT_FOUND
            else:
                text = source.display(span)
                confidence = _confidence(raw.get("confidence"))
                issue = None
                if not value_visible_in_quote(kind, value, text):
                    confidence = min(confidence, UNVERIFIED_VALUE_CONFIDENCE)
                    issue = "The value is not written in its quote; check it."
                return {
                    "value": value,
                    "quote": text,
                    "section": normalize_value("text", raw.get("section")) if not _is_blank(raw.get("section")) else None,
                    "confidence": confidence,
                    "issue": issue,
                    "verified": True,
                    **_located(source, span),
                }, None
        if rank[failure] > rank[reason]:
            reason = failure
    return None, reason


# ─── Chunking ────────────────────────────────────────────────────────────────

def chunks(text: str, size: int, overlap: int) -> List[Tuple[int, str]]:
    """(offset, piece) windows over `text`."""
    if len(text) <= size:
        return [(0, text)]
    out: List[Tuple[int, str]] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        out.append((start, text[start:end]))
        if end >= len(text):
            break
        start = end - overlap
    return out


# ─── The pipeline ────────────────────────────────────────────────────────────

def extract_key_terms(
    text: str,
    *,
    invoke: Invoke,
    contract_type: Optional[str] = None,
    custom_fields: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Run the extraction over `text` and return verified records only.

    Raises KeyTermExtractionFailed if not one model call succeeded. Individual
    call failures are recorded in `errors` and the run continues: a contract
    whose clause pass failed still gets its key terms.
    """
    source = SourceText(text)
    custom_fields = custom_fields or []
    known_type = (contract_type or "").upper() or None
    errors: List[str] = []
    calls_ok = 0

    def call(system: str, user: str, label: str) -> Dict[str, Any]:
        nonlocal calls_ok
        try:
            data = parse_json_object(invoke(system, user))
        except (NoProviderConfigured, PlatformCostCapExceeded):
            raise  # not a per-call problem: every later call would fail the same way
        except Exception as exc:
            logger.warning("key terms: %s failed: %s", label, exc)
            errors.append(f"{label}: {str(exc)[:200]}")
            return {}
        calls_ok += 1
        return data

    # 1. Fields, flags, type/custom fields, findings — candidates per chunk.
    field_candidates: Dict[str, List[Dict[str, Any]]] = {f.name: [] for f in FIELDS}
    type_candidates: Dict[str, List[Dict[str, Any]]] = {}
    custom_candidates: Dict[str, List[Dict[str, Any]]] = {}
    party_candidates: List[Dict[str, Any]] = []
    finding_candidates: List[Dict[str, Any]] = []
    flags: Dict[str, bool] = {}
    fields_system = _fields_prompt(known_type, custom_fields)
    field_windows = chunks(text, FIELD_CHUNK, FIELD_OVERLAP)
    for i, (_offset, piece) in enumerate(field_windows):
        data = call(fields_system, _wrap(piece, f"contract text (part {i + 1} of {len(field_windows)})"), f"fields {i + 1}")
        for name, raw in _dict(data.get("fields")).items():
            if name in field_candidates:
                field_candidates[name].append(_dict(raw))
        for key, raw in _dict(data.get("typeFields")).items():
            type_candidates.setdefault(str(key), []).append(_dict(raw))
        for key, raw in _dict(data.get("customFields")).items():
            custom_candidates.setdefault(str(key), []).append(_dict(raw))
        party_candidates += [p for p in _list(data.get("parties")) if isinstance(p, dict)]
        finding_candidates += [f for f in _list(data.get("openEndedFindings")) if isinstance(f, dict)]
        for flag, value in _dict(data.get("clauseFlags")).items():
            if flag in CLAUSE_FLAGS and to_bool(value) is not None:
                flags[flag] = flags.get(flag, False) or bool(to_bool(value))

    fields: Dict[str, Dict[str, Any]] = {}
    absent: Dict[str, str] = {}
    for spec in FIELDS:
        record, reason = verify_term(spec.kind, field_candidates[spec.name], source)
        if record:
            fields[spec.name] = record
        else:
            absent[spec.name] = reason or NOT_STATED

    # 2. A focused second look for the fields that matter most when missed.
    missing = [name for name in RECOVERY_FIELDS if name not in fields]
    if missing and text.strip():
        data = call(_recovery_prompt(missing), _wrap(text[:FIELD_CHUNK], "contract text (missing-field pass)"), "recovery")
        for name in missing:
            record, reason = verify_term(FIELD_BY_NAME[name].kind, [_dict(_dict(data.get("fields")).get(name))], source)
            if record:
                fields[name] = record
                absent.pop(name, None)
            elif reason != NOT_STATED:
                absent[name] = reason

    parties = _verify_parties(party_candidates, source)
    type_fields = _verify_keyed(type_candidates, _type_kinds(known_type), source, labels=_type_labels(known_type))
    custom = _verify_keyed(custom_candidates, _custom_kinds(custom_fields), source)
    findings = _verify_findings(finding_candidates, source)

    # 3. Clauses, located by their anchors.
    clauses, clause_ledger = _extract_clauses(text, source, call)

    # 4. Classification, risk and summary, from what verified.
    score = call(_SCORE_PROMPT, _wrap(json.dumps(_score_context(fields, parties, flags, clauses, known_type), indent=1),
                                      "verified contract terms and clause text"), "score")

    if calls_ok == 0:
        raise KeyTermExtractionFailed("; ".join(errors) or "no model call succeeded")

    contract_type_out = known_type if known_type in CONTRACT_TYPES else None
    if contract_type_out is None:
        guess = str(score.get("contractType") or "").upper().strip()
        contract_type_out = guess if guess in CONTRACT_TYPES else "OTHER"
    risk = to_number(score.get("riskScore"))
    confidences = [r["confidence"] for r in fields.values()]
    proposed = sum(1 for spec in FIELDS if any(not _is_blank(_dict(c).get("value")) for c in field_candidates[spec.name]))
    return {
        "fields": fields,
        "absent": absent,
        "parties": parties,
        "clauseFlags": flags,
        "typeFields": type_fields,
        "customFields": custom,
        "openEndedFindings": findings,
        "clauses": clauses,
        "contractType": contract_type_out,
        "suggestedTitle": normalize_value("text", score.get("suggestedTitle") or "") or None,
        "summary": normalize_value("text", score.get("summary") or "") or None,
        "riskScore": None if risk is None else round(max(0.0, min(1.0, risk)), 2),
        "riskFactors": [str(f)[:300] for f in _list(score.get("riskFactors")) if not _is_blank(f)][:20],
        "overallConfidence": round(sum(confidences) / len(confidences), 2) if confidences else 0.0,
        "hasPages": source.has_pages,
        "ledger": {
            "fieldsProposed": proposed,
            "fieldsVerified": len(fields),
            "fieldsDropped": sum(1 for r in absent.values() if r != NOT_STATED),
            **clause_ledger,
        },
        "errors": errors,
    }


def _verify_parties(candidates: List[Dict[str, Any]], source: SourceText) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for raw in candidates:
        name = normalize_value("text", raw.get("name") or "")
        if not name or name.lower() in seen:
            continue
        # A party is kept if its name or its quote is in the contract.
        span = source.locate(str(raw.get("quote") or "")) or source.locate(name)
        if span is None:
            continue
        seen.add(name.lower())
        out.append({
            "role": normalize_value("text", raw.get("role") or "") or None,
            "name": name[:200],
            "quote": source.display(span),
            **_located(source, span),
        })
    return out[:10]


def _type_kinds(contract_type: Optional[str]) -> Dict[str, str]:
    return {f["key"]: _kind_for(f.get("type")) for f in TYPE_SCHEMAS.get(contract_type or "", [])}


def _type_labels(contract_type: Optional[str]) -> Dict[str, str]:
    return {f["key"]: f["label"] for f in TYPE_SCHEMAS.get(contract_type or "", [])}


def _custom_kinds(custom_fields: List[Dict[str, Any]]) -> Dict[str, str]:
    return {str(f.get("fieldKey")): _kind_for(f.get("fieldType")) for f in custom_fields if f.get("fieldKey")}


def _kind_for(declared: Any) -> str:
    return {"number": "number", "boolean": "boolean", "date": "date"}.get(str(declared or "text"), "text")


def _verify_keyed(
    candidates: Dict[str, List[Dict[str, Any]]],
    kinds: Dict[str, str],
    source: SourceText,
    *,
    labels: Optional[Dict[str, str]] = None,
) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for key, kind in kinds.items():
        record, _reason = verify_term(kind, candidates.get(key, []), source)
        if record:
            if labels:
                record["label"] = labels.get(key, key)
            out[key] = record
    return out


def _verify_findings(candidates: List[Dict[str, Any]], source: SourceText) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for raw in candidates:
        key = re.sub(r"[^a-z0-9_]+", "_", str(raw.get("key") or "").lower()).strip("_")[:60]
        if not key or key in seen:
            continue
        record, _reason = verify_term("text", [raw], source)
        if not record:
            continue
        seen.add(key)
        record["key"] = key
        record["label"] = normalize_value("text", raw.get("label") or key) or key
        out.append(record)
    return out[:15]


def _extract_clauses(text: str, source: SourceText, call: Callable[[str, str, str], Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    proposed = 0
    kept: List[Dict[str, Any]] = []
    windows = chunks(text, CLAUSE_CHUNK, CLAUSE_OVERLAP)
    for i, (offset, piece) in enumerate(windows):
        data = call(_CLAUSES_PROMPT, _wrap(piece, f"contract text (part {i + 1} of {len(windows)})"), f"clauses {i + 1}")
        for raw in _list(data.get("clauses")):
            if not isinstance(raw, dict):
                continue
            proposed += 1
            span = _clause_span(source, raw, offset)
            if span is None:
                continue
            if any(_overlap(span, (c["spanStart"], c["spanEnd"])) > 0.5 for c in kept):
                continue  # the same clause again, from the overlapping window
            clause_type = str(raw.get("clauseType") or "").strip().lower()
            rating = str(raw.get("riskRating") or "").strip().lower()
            kept.append({
                "clauseType": clause_type if clause_type in _CLAUSE_TYPES else "general",
                "content": source.display(span),
                "interpretation": normalize_value("text", raw.get("interpretation") or "") or None,
                "riskRating": rating if rating in RISK_RATINGS else None,
                "sectionRef": normalize_value("text", raw.get("sectionRef") or "") if not _is_blank(raw.get("sectionRef")) else None,
                **_located(source, span),
            })
            if len(kept) >= MAX_CLAUSES:
                break
    kept.sort(key=lambda c: c["spanStart"])
    for order, clause in enumerate(kept):
        clause["sortOrder"] = order
    return kept, {"clausesProposed": proposed, "clausesKept": len(kept), "clausesDropped": proposed - len(kept)}


def _clause_span(source: SourceText, raw: Dict[str, Any], offset: int) -> Optional[Span]:
    start, end = str(raw.get("start") or ""), str(raw.get("end") or "")
    if not start.strip() or not end.strip():
        return None
    # Search from the window the model was shown: the same opening words can
    # recur in a long contract ("The Supplier shall...").
    first = source.locate(start, after=offset)
    if first is None:
        return None
    close = source.locate(end, after=first.start)
    if close is None or close.end - first.start > MAX_CLAUSE_CHARS:
        return source.locate_between(start, end, max_chars=MAX_CLAUSE_CHARS)
    return Span(first.start, close.end)


def _overlap(a: Span, b: Tuple[int, int]) -> float:
    inter = min(a.end, b[1]) - max(a.start, b[0])
    if inter <= 0:
        return 0.0
    return inter / max(1, min(a.end - a.start, b[1] - b[0]))


def _score_context(
    fields: Dict[str, Dict[str, Any]],
    parties: List[Dict[str, Any]],
    flags: Dict[str, bool],
    clauses: List[Dict[str, Any]],
    contract_type: Optional[str],
) -> Dict[str, Any]:
    flagged = {c for c in ("limitation_of_liability", "uncapped_liability", "indemnification", "auto_renewal",
                           "exclusivity", "mfn", "ip_ownership", "termination", "change_of_control")}
    significant: List[Dict[str, Any]] = []
    for clause in clauses:
        if len(significant) < 6 or clause["clauseType"] in flagged:
            significant.append({"type": clause["clauseType"], "section": clause.get("sectionRef"),
                                "text": clause["content"][:1500]})
        if len(significant) >= 12:
            break
    context: Dict[str, Any] = {
        "terms": {name: {"value": r["value"], "quote": r["quote"]} for name, r in fields.items()},
        "parties": [{"role": p.get("role"), "name": p["name"]} for p in parties],
        "clauseFlags": flags,
        "significantClauses": significant,
    }
    if contract_type:
        context["contractTypeHint"] = contract_type
    return context
