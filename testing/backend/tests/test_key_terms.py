"""Key terms that are only stored with a quote found in the contract.

The extractor that replaced draftLegal's review agent (services/key_terms.py)
holds every record to one rule: a value comes with a verbatim quote that is
really in the source, or it is reported absent with the reason. These tests
run the whole pipeline against a scripted model, so each rule is checked
without a provider.
"""
import json

import pytest

from services import key_terms as kt
from services.platform_analysis import (
    ANALYSIS_COPY,
    INDEX_WAIT,
    LINK_WAIT,
    PLATFORM_TEXT,
    WAIT,
    build_payload,
    choose_source,
    new_request,
    push,
)
from services.quote_locator import SourceText, normalize

CONTRACT = """--- Page 1 ---

MASTER SERVICES AGREEMENT

This Agreement is entered into by **Acme Logistics Ltd** ("Supplier") and Northwind Retail plc ("Client").

1. Term. This Agreement commences on 1 March 2025 and continues for three (3) years.

--- Page 2 ---

2. Fees. The Client shall pay the Supplier a total fee of £1,500,000 payable within thirty (30) days of invoice.

3. Termination. Either party may terminate this Agreement on ninety (90) days’ written notice to the other party.

--- Page 3 ---

4. Governing law. This Agreement is governed by the laws of England and Wales.

5. Liability. The Supplier’s aggregate liability shall not exceed the fees paid in the twelve months preceding the claim.
"""


# ── the locator ─────────────────────────────────────────────────────────────

def test_a_quote_is_found_despite_presentation_and_mapped_to_its_page():
    src = SourceText(CONTRACT)
    # Markdown emphasis, curly quotes, case and spacing are presentation.
    span = src.locate('entered into by ACME   Logistics Ltd ("Supplier")')
    assert span is not None
    assert src.display(span) == 'entered into by Acme Logistics Ltd ("Supplier")'
    assert src.pages(span) == (1, 1)

    span = src.locate("ninety (90) days' written notice")
    assert src.page_at(span.start) == 2


def test_a_paraphrase_is_not_a_quote():
    src = SourceText(CONTRACT)
    assert src.locate("either party can end the agreement with 90 days notice") is None
    # Too short to point at one place.
    assert src.locate("the") is None


def test_a_quote_running_across_a_page_break_is_found_and_spans_both_pages():
    src = SourceText(CONTRACT)
    span = src.locate("continues for three (3) years. 2. Fees.")
    assert span is not None
    assert src.pages(span) == (1, 2)
    assert "Page" not in src.display(span)


def test_text_without_page_markers_has_no_pages():
    src = SourceText("Plain text contract. The Client shall pay within 30 days.")
    span = src.locate("shall pay within 30 days")
    assert span is not None and src.page_at(span.start) is None
    assert not src.has_pages


def test_normalize_is_what_both_sides_are_compared_on():
    assert normalize("seven‑day **Notice**") == normalize("Seven-day notice")


def test_between_anchors_takes_the_nearest_end_and_refuses_a_runaway():
    src = SourceText(CONTRACT)
    span = src.locate_between("3. Termination. Either party", "written notice to the other party.", max_chars=500)
    assert src.display(span).startswith("3. Termination.")
    assert src.display(span).endswith("written notice to the other party.")
    assert src.locate_between("MASTER SERVICES AGREEMENT", "preceding the claim.", max_chars=100) is None


# ── the extractor, against a scripted model ────────────────────────────────

def scripted(fields=None, clauses=None, score=None, recovery=None, fail=()):
    """A model that answers each prompt kind from a script."""
    calls = []

    def invoke(system, user):
        kind = ("fields" if system.startswith("You extract key terms")
                else "clauses" if system.startswith("You segment a contract")
                else "recovery" if system.startswith("A first pass")
                else "score")
        calls.append((kind, user))
        invoke.systems.append((kind, system))
        if kind in fail:
            raise RuntimeError(f"{kind} blew up")
        answer = {"fields": fields, "clauses": clauses, "score": score, "recovery": recovery}[kind]
        return json.dumps(answer or {})

    invoke.calls = calls
    invoke.systems = []
    return invoke


FIELDS = {
    "fields": {
        "effectiveDate": {"value": "2025-03-01", "quote": "commences on 1 March 2025", "confidence": 0.95},
        "value": {"value": 1500000, "quote": "a total fee of £1,500,000", "confidence": 0.9},
        # Stated nowhere: a guess from the £ sign, with no quote.
        "currency": {"value": "GBP", "quote": None, "confidence": 0.5},
        "governingLaw": {"value": "England and Wales", "quote": "governed by the laws of England and Wales", "confidence": 0.95},
        "noticePeriodDays": {"value": 90, "quote": "ninety (90) days' written notice", "confidence": 0.9},
        # The quote says 30; the value says 45.
        "paymentTermsDays": {"value": 45, "quote": "payable within thirty (30) days of invoice", "confidence": 0.9},
        # A fabricated quote.
        "autoRenew": {"value": True, "quote": "renews automatically for successive one-year terms", "confidence": 0.8},
        "expiryDate": {"value": None, "quote": None},
    },
    "parties": [
        {"role": "Supplier", "name": "Acme Logistics Ltd", "quote": 'Acme Logistics Ltd** ("Supplier")'},
        {"role": "Client", "name": "Northwind Retail plc", "quote": 'Northwind Retail plc ("Client")'},
        {"role": "Guarantor", "name": "Imaginary Holdings", "quote": "Imaginary Holdings guarantees"},
    ],
    "clauseFlags": {"limitationOfLiability": True, "mfn": "false"},
    "openEndedFindings": [
        {"key": "Liability Basis", "label": "Liability basis", "value": "fees paid in prior 12 months",
         "quote": "fees paid in the twelve months preceding the claim", "confidence": 0.8},
        {"key": "made_up", "value": "x", "quote": "not in the contract at all, no", "confidence": 0.9},
    ],
}

CLAUSES = {"clauses": [
    {"clauseType": "limitation_of_liability", "start": "5. Liability. The Supplier's aggregate liability",
     "end": "twelve months preceding the claim.", "riskRating": "favorable", "sectionRef": "5"},
    {"clauseType": "termination", "start": "3. Termination. Either party may terminate",
     "end": "written notice to the other party.", "interpretation": "Either side can leave on 90 days' notice.",
     "riskRating": "neutral", "sectionRef": "Section 3"},
    {"clauseType": "payment", "start": "The Client shall pay the Supplier a total fee",
     "end": "within thirty (30) days of invoice.", "riskRating": "sideways"},
    # Anchors that are not in the text: dropped, and counted.
    {"clauseType": "indemnification", "start": "The Supplier shall indemnify the Client against",
     "end": "arising from the Services.", "riskRating": "unfavorable"},
    # Not a clause type we know.
    {"clauseType": "vibes", "start": "4. Governing law. This Agreement", "end": "laws of England and Wales."},
]}

SCORE = {"contractType": "SOW", "suggestedTitle": "Acme – Northwind MSA", "summary": "A services agreement.",
         "riskScore": 1.7, "riskFactors": ["Capped liability", ""]}


def run(**over):
    invoke = over.pop("invoke", None) or scripted(FIELDS, CLAUSES, SCORE, over.pop("recovery", None))
    return kt.extract_key_terms(CONTRACT, invoke=invoke, **over), invoke


def test_a_verified_term_carries_its_quote_page_and_span():
    result, _ = run()
    law = result["fields"]["governingLaw"]
    assert law["value"] == "England and Wales"
    assert law["quote"] == "governed by the laws of England and Wales"
    assert law["page"] == 3 and law["verified"] is True
    assert CONTRACT[law["spanStart"]:law["spanEnd"]] == "governed by the laws of England and Wales"
    assert result["fields"]["effectiveDate"]["value"] == "2025-03-01"
    assert result["fields"]["value"]["value"] == 1500000.0


def test_nothing_is_defaulted_every_miss_says_why():
    result, _ = run()
    assert result["absent"]["currency"] == kt.NO_QUOTE            # a guess, no quote
    assert result["absent"]["autoRenew"] == kt.QUOTE_NOT_FOUND     # fabricated quote
    assert result["absent"]["expiryDate"] == kt.NOT_STATED
    assert "currency" not in result["fields"] and "autoRenew" not in result["fields"]
    assert result["ledger"]["fieldsDropped"] == 2


def test_a_value_its_own_quote_contradicts_is_kept_but_sent_to_review():
    result, _ = run()
    terms = result["fields"]["paymentTermsDays"]
    assert terms["value"] == 45
    assert terms["confidence"] <= kt.UNVERIFIED_VALUE_CONFIDENCE and terms["issue"]
    # "ninety (90)" matches 90.
    assert result["fields"]["noticePeriodDays"]["issue"] is None


def test_parties_findings_and_flags_need_their_text_too():
    result, _ = run()
    assert [p["name"] for p in result["parties"]] == ["Acme Logistics Ltd", "Northwind Retail plc"]
    assert result["parties"][0]["page"] == 1
    assert [f["key"] for f in result["openEndedFindings"]] == ["liability_basis"]
    assert result["clauseFlags"] == {"limitationOfLiability": True, "mfn": False}


def test_clauses_are_the_contracts_own_text_located_by_their_anchors():
    result, _ = run()
    clauses = result["clauses"]
    # In document order, whatever order the model gave them in.
    assert [c["clauseType"] for c in clauses] == ["payment", "termination", "general", "limitation_of_liability"]
    assert [c["sortOrder"] for c in clauses] == [0, 1, 2, 3]
    termination = clauses[1]
    assert termination["content"] == (
        "3. Termination. Either party may terminate this Agreement on ninety (90) days’ "
        "written notice to the other party."
    )
    assert termination["page"] == 2 and termination["sectionRef"] == "Section 3"
    assert clauses[0]["riskRating"] is None  # "sideways" is not a rating
    assert result["ledger"]["clausesProposed"] == 5
    assert result["ledger"]["clausesKept"] == 4
    assert result["ledger"]["clausesDropped"] == 1


def test_the_same_clause_from_overlapping_windows_is_kept_once():
    doubled = {"clauses": CLAUSES["clauses"][:2] + CLAUSES["clauses"][:2]}
    result, _ = run(invoke=scripted(FIELDS, doubled, SCORE))
    assert len(result["clauses"]) == 2


def test_a_known_type_is_kept_and_its_fields_are_asked_for():
    fields = dict(FIELDS, typeFields={
        "deliverables": {"value": "Logistics services", "quote": "MASTER SERVICES AGREEMENT", "confidence": 0.7},
        "not_in_schema": {"value": "x", "quote": "MASTER SERVICES AGREEMENT"},
    })
    result, invoke = run(invoke=scripted(fields, CLAUSES, SCORE), contract_type="SOW")
    assert result["contractType"] == "SOW"
    fields_prompt = next(sys for k, sys in invoke.systems if k == "fields")
    assert '"typeFields"' in fields_prompt and "deliverables" in fields_prompt
    assert set(result["typeFields"]) == {"deliverables"}
    assert result["typeFields"]["deliverables"]["label"] == "Deliverables"


def test_without_a_type_the_models_classification_is_used_if_it_is_one():
    result, _ = run(invoke=scripted(FIELDS, CLAUSES, dict(SCORE, contractType="MSA")))
    assert result["contractType"] == "MSA"
    result, _ = run(invoke=scripted(FIELDS, CLAUSES, dict(SCORE, contractType="Spaceship")))
    assert result["contractType"] == "OTHER"


def test_score_is_clamped_and_blank_factors_dropped():
    result, _ = run()
    assert result["riskScore"] == 1.0
    assert result["riskFactors"] == ["Capped liability"]
    assert 0 < result["overallConfidence"] <= 1


def test_org_fields_are_verified_like_any_other():
    fields = dict(FIELDS, customFields={
        "po_number": {"value": "PO-1", "quote": "PO-1 is the purchase order"},
        "territory": {"value": ["England", "Wales"], "quote": "laws of England and Wales"},
    })
    custom = [{"fieldKey": "po_number", "fieldLabel": "PO", "fieldType": "text"},
              {"fieldKey": "territory", "fieldLabel": "Territory", "fieldType": "multiselect"}]
    result, invoke = run(invoke=scripted(fields, CLAUSES, SCORE), custom_fields=custom)
    assert set(result["customFields"]) == {"territory"}
    assert result["customFields"]["territory"]["value"] == "England, Wales"
    fields_prompt = next(sys for k, sys in invoke.systems if k == "fields")
    assert '"customFields"' in fields_prompt and "po_number" in fields_prompt


def test_the_recovery_pass_runs_only_for_missing_key_fields():
    recovery = {"fields": {"expiryDate": {"value": "2028-02-29", "quote": "continues for three (3) years"}}}
    result, invoke = run(recovery=recovery)
    kinds = [k for k, _ in invoke.calls]
    assert kinds.count("recovery") == 1
    # 2028-02-29 is a real date; the quote verifies; it is filled.
    assert result["fields"]["expiryDate"]["value"] == "2028-02-29"
    assert "expiryDate" not in result["absent"]

    complete = dict(FIELDS, fields=dict(FIELDS["fields"], expiryDate={
        "value": "2028-02-29", "quote": "continues for three (3) years"}))
    _, invoke = run(invoke=scripted(complete, CLAUSES, SCORE))
    assert "recovery" not in [k for k, _ in invoke.calls]


def test_contract_text_reaches_the_model_framed_as_untrusted_data():
    _, invoke = run()
    for kind, user in invoke.calls:
        if kind in {"fields", "clauses"}:
            assert "DATA ONLY" in user and "MASTER SERVICES AGREEMENT" in user


def test_one_failed_call_does_not_lose_the_rest():
    result, _ = run(invoke=scripted(FIELDS, CLAUSES, SCORE, fail=("clauses",)))
    assert result["clauses"] == [] and result["fields"]
    assert any(e.startswith("clauses 1") for e in result["errors"])


def test_no_successful_call_is_a_failure_not_an_empty_analysis():
    with pytest.raises(kt.KeyTermExtractionFailed):
        run(invoke=scripted(fail=("fields", "clauses", "score", "recovery")))


def test_no_provider_stops_the_run_at_once():
    def invoke(system, user):
        raise kt.NoProviderConfigured("no key")
    with pytest.raises(kt.NoProviderConfigured):
        kt.extract_key_terms(CONTRACT, invoke=invoke)


@pytest.mark.parametrize("raw,expected", [
    ("2025-03-01", "2025-03-01"),
    ("1 March 2025", "2025-03-01"),
    ("March 1, 2025", "2025-03-01"),
    ("03/04/2025", None),      # ambiguous: day or month first
    ("2025-02-30", None),      # not a date
    ("soon", None),
])
def test_dates_are_read_only_when_unambiguous(raw, expected):
    assert kt.to_date(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("£1,500,000", 1_500_000.0), ("1.5 million", 1_500_000.0), ("250k", 250_000.0), (12, 12.0), ("n/a", None),
])
def test_amounts(raw, expected):
    assert kt.to_number(raw) == expected


def test_value_visible_in_quote_reads_scaled_amounts():
    assert kt.value_visible_in_quote("number", 1_500_000, "a fee of £1.5 million")
    assert kt.value_visible_in_quote("number", 1_500_000, "a fee of £1,500,000")
    assert not kt.value_visible_in_quote("integer", 45, "within 30 days")
    assert kt.value_visible_in_quote("integer", 30, "within thirty days")


# ── which text, and what goes back ─────────────────────────────────────────

def _request(**over):
    base = new_request("c1", org_id="o1", version_id="v1", plain_text="plain text", contract_type="MSA",
                       custom_fields=[], expect_linked=True, run_id="run1")
    base.update(over)
    return base


def test_source_waits_for_the_copy_then_falls_back_to_the_platform_text():
    req = _request()
    t0 = req["requested_at"]
    assert choose_source(req, None, t0) == (WAIT, "")
    assert choose_source(req, None, t0 + LINK_WAIT) == (PLATFORM_TEXT, "plain text")
    indexing = {"status": "Processing", "index": {"status": "processing"}}
    assert choose_source(req, indexing, t0 + LINK_WAIT) == (WAIT, "")
    assert choose_source(req, indexing, t0 + INDEX_WAIT) == (PLATFORM_TEXT, "plain text")
    done = {"index": {"status": "success", "content": "--- Page 1 ---\nText"}}
    assert choose_source(req, done, t0) == (ANALYSIS_COPY, "--- Page 1 ---\nText")
    failed = {"status": "Index Error", "index": {"status": "error"}}
    assert choose_source(req, failed, t0) == (PLATFORM_TEXT, "plain text")


def test_a_contract_that_will_never_be_linked_does_not_wait():
    req = _request(expect_linked=False)
    assert choose_source(req, None, req["requested_at"]) == (PLATFORM_TEXT, "plain text")


def test_only_a_successful_run_carries_an_analysis():
    result, _ = run()
    ok = build_payload("c1", run_id="run1", version_id="v1", status="success", source=ANALYSIS_COPY,
                       result=dict(result, errors=["clauses 2: timeout"]))
    assert ok["analysis"]["fields"] and "errors" not in ok["analysis"]
    assert ok["warnings"] == ["clauses 2: timeout"]
    failed = build_payload("c1", run_id="run1", version_id="v1", status="error", error="boom", result=result)
    assert failed["analysis"] is None and failed["error"] == "boom"


def test_delivery_goes_to_the_contracts_analysis_sync():
    seen = {}

    class Ok:
        status_code = 200

    def post(url, json, headers, timeout):
        seen.update(url=url, secret=headers["x-internal-secret"])
        return Ok()

    payload = build_payload("cm123", run_id="r", version_id="v", status="skipped", error="AI is off")
    assert push(payload, post=post, api_url="http://api", secret="s")["status"] == "delivered"
    assert seen == {"url": "http://api/api/internal/contracts/cm123/analysis/sync", "secret": "s"}
