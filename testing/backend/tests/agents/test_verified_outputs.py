"""draftLegal's remaining agents, held to the platform's rules (agent merge P5).

Drafting from chat is a proposal, not a write. Quotes that a compliance
finding, a playbook judgement or a redline presents as the contract's words
are checked against the text they came from. A linked contract's ingestion
runs on its org's model choice.
"""
from agents_service.quotes import verified_changes, verify_field
from agents_service.routes.assist import verify_judgement
from agents_service.tools.contract_create_from_template import draft_proposal
from services.quote_locator import SourceText

CLAUSE = ("The Supplier's aggregate liability under this Agreement shall not exceed the fees paid in the "
          "twelve (12) months preceding the claim. The Supplier shall notify the Customer of any breach within 72 hours.")


def test_a_chat_draft_is_a_proposal_with_its_preview():
    card = draft_proposal({
        "html": "<h1>Mutual NDA</h1><p>Between Acme and Globex.</p>", "usedTemplateId": "tpl_1",
        "usedTemplateName": "Mutual NDA", "contractType": "NDA",
        "variableValues": {"counterparty_name": "Globex", "term": "2 years"},
        "unfilledVariables": ["effectiveDate"], "completenessScore": 0.8,
        # The reviewer's commentary, which on cs2 listed "governing law" for a
        # draft whose governing law was filled: notes, not the to-fill list.
        "missingFields": ["governing law / jurisdiction"], "reviewNotes": "Looks complete.",
    }, title=None, counterparty_name="Globex")
    assert card["awaitingConfirmation"] is True and card["reversible"] is True
    assert card["args"] == {"templateId": "tpl_1", "variables": {"counterparty_name": "Globex", "term": "2 years"},
                            "title": "Globex — NDA", "counterpartyName": "Globex"}
    assert card["preview"]["html"].startswith("<h1>Mutual NDA")
    assert card["preview"]["missingFields"] == ["effectiveDate"]
    assert "1 field still to fill" in card["preview"]["summary"]
    assert card["preview"]["reviewNotes"] == "Looks complete. Reviewer flagged: governing law / jurisdiction."


def test_no_template_is_an_error_not_an_empty_draft():
    assert draft_proposal({"error": None, "usedTemplateId": "", "html": ""}, title=None, counterparty_name=None)["error"] == "NO_TEMPLATE_MATCH"
    assert draft_proposal({"error": "boom", "usedTemplateId": "t", "html": "x"}, title=None, counterparty_name=None)["error"] == "DRAFT_FAILED"


def test_redline_changes_keep_only_a_before_that_is_in_the_clause():
    changes = verified_changes([
        {"before": "twelve  (12) months", "after": "twenty-four (24) months", "reason": "longer lookback"},
        {"before": "the Supplier may never be liable", "after": "x", "reason": "invented"},
        "junk",
    ], CLAUSE)
    assert changes == [{"before": "twelve (12) months", "after": "twenty-four (24) months", "reason": "longer lookback"}]


def test_judge_evidence_not_in_the_clause_undoes_its_verdict():
    result = verify_judgement({
        "mustHave": [
            {"id": "cap", "passed": True, "evidence": "shall not exceed the fees paid"},
            {"id": "notice", "passed": True, "evidence": "notify the Customer within 24 hours"},
        ],
        "mustNot": [
            {"id": "uncapped", "passed": False, "evidence": "liability is unlimited"},
            {"id": "exclusivity", "passed": True, "evidence": ""},
        ],
    }, CLAUSE)
    have, must_not = result["mustHave"], result["mustNot"]
    assert have[0]["passed"] is True and have[0]["evidenceVerified"] is True
    assert have[1]["passed"] is None and have[1]["evidence"] == ""        # 24 hours is not what it says
    assert must_not[0]["passed"] is None                                  # a breach on invented evidence
    assert must_not[1]["passed"] is True                                  # nothing to check, verdict stands


def test_a_compliance_quote_is_kept_in_the_contracts_words_or_removed():
    source = SourceText(CLAUSE)
    found = {"quote": "notify the customer of any breach within 72 hours"}
    assert verify_field(found, "quote", source) is True
    assert found["quote"] == "notify the Customer of any breach within 72 hours" and found["quoteVerified"] is True
    invented = {"quote": "The Supplier shall appoint a Data Protection Officer."}
    assert verify_field(invented, "quote", source) is False and invented["quote"] is None


def test_a_linked_contracts_overview_runs_on_its_orgs_model():
    from services.contract_agent.rag.facade import ContractRAGSystem
    from services.platform_models import use_platform_org

    rag = ContractRAGSystem(ai_provider="groq")
    assert rag._run_provider() == "groq"            # standalone ContractSense: its own default
    with use_platform_org("org_1"):
        assert rag._run_provider() is None          # the org's Admin → AI choice decides
