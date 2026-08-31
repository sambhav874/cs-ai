"""Reading the promised escalation out of a contract, and holding the measured
movements against it.

No Mongo. Both halves are pure: pattern matching over document text, and
arithmetic over the movements the tracker already measured.
"""

import pytest

from services.escalation import (
    CAPPED,
    FIXED,
    INDEXED,
    check_escalation,
    expected_movement,
    extract_escalation_clauses,
    render_escalation,
)


# ---------------------------------------------------------------- extraction


def test_a_fixed_annual_uplift_written_in_words_and_figures_is_one_promise():
    """"three per cent (3.00%)" states one rate twice, not two rates."""
    text = (
        "2.7 With effect from 01 April 2023 and on each anniversary thereafter, "
        "all charges set out in Paragraph 1 shall be increased by three per cent "
        "(3.00%) per annum, compounded annually, rounded to two decimal places."
    )
    clauses = extract_escalation_clauses(text)

    assert len(clauses) == 1
    assert clauses[0]["basis"] == FIXED
    assert clauses[0]["rate_pct"] == 3.0
    assert clauses[0]["compounded"] is True
    assert clauses[0]["ambiguous"] is False


def test_any_stated_rate_is_read_not_only_an_index():
    """A contract that simply says 10% a year is the common case, and nothing
    about this is specific to inflation indexation."""
    clauses = extract_escalation_clauses(
        "Charges shall increase by 10% per annum on each anniversary."
    )
    assert clauses[0]["rate_pct"] == 10.0
    assert clauses[0]["basis"] == FIXED
    assert clauses[0]["compounded"] is False


def test_a_cap_is_not_read_as_a_fixed_rate():
    """"shall not exceed 5%" permits a 3% move; a fixed 5% does not."""
    clauses = extract_escalation_clauses(
        "The annual increase shall not exceed five per cent (5%) in any year."
    )
    assert clauses[0]["basis"] == CAPPED


def test_an_index_linked_rule_carries_no_rate():
    clauses = extract_escalation_clauses(
        "Charges shall be adjusted annually in line with the Consumer Price Index."
    )
    assert clauses[0]["basis"] == INDEXED
    assert clauses[0]["rate_pct"] is None


def test_a_one_off_increase_is_not_an_escalation_rule():
    """A single 5% rise is not a rule, and comparing every later revision
    against it would report breaches that were never promised."""
    assert extract_escalation_clauses(
        "The parties agree a one-time increase of 5% to the handling charges."
    ) == []


def test_an_unrelated_percentage_is_not_mistaken_for_an_uplift():
    text = (
        "A service credit of 2% shall apply per breach. "
        "VAT at 20% is charged on all invoices."
    )
    assert extract_escalation_clauses(text) == []


def test_two_different_rates_in_one_sentence_are_flagged_not_averaged():
    clauses = extract_escalation_clauses(
        "Charges increase annually by 3% for ramp services and 5% for passenger services."
    )
    assert clauses[0]["ambiguous"] is True


def test_empty_content_yields_nothing():
    assert extract_escalation_clauses("") == []


def test_the_same_clause_repeated_is_reported_once():
    sentence = "Charges shall increase by 3% per annum.\n"
    assert len(extract_escalation_clauses(sentence * 3)) == 1


# --------------------------------------------------------------- arithmetic


def test_compounding_and_simple_differ_over_more_than_one_year():
    assert expected_movement(3.0, 2, compounded=True) == pytest.approx(6.09, abs=0.01)
    assert expected_movement(3.0, 2, compounded=False) == pytest.approx(6.00, abs=0.01)


def test_one_year_is_the_same_either_way():
    assert expected_movement(3.0, 1, compounded=True) == pytest.approx(
        expected_movement(3.0, 1, compounded=False)
    )


# ------------------------------------------------------------------ checking


def clause(rate=3.0, basis=FIXED, compounded=True, ambiguous=False):
    return {"basis": basis, "rate_pct": rate, "compounded": compounded,
            "ambiguous": ambiguous, "quote": "increased by 3.00% per annum",
            "char_start": 0}


def lineage(pairs, caption="RAMP SERVICES"):
    versions = []
    for date, pct in pairs:
        versions.append({"contract_id": date, "contract_name": f"{date}.pdf",
                         "effective_date": date, "observed_pct": pct})
    return {"signature": "sig-1", "caption": caption, "versions": versions}


def test_a_movement_matching_the_rule_is_reported_as_promised():
    found = check_escalation(
        [clause()], [lineage([("2022-04-01", None), ("2023-04-01", 3.0)])]
    )
    assert len(found) == 1
    assert found[0]["status"] == "as_promised"
    assert found[0]["severity"] == "info"


def test_a_movement_above_the_rule_is_a_warning():
    found = check_escalation(
        [clause()], [lineage([("2022-04-01", None), ("2023-04-01", 6.0)])]
    )
    assert found[0]["status"] == "above_promised"
    assert found[0]["severity"] == "warning"
    assert found[0]["variance_pct"] == pytest.approx(3.0, abs=0.01)


def test_a_movement_below_the_rule_is_noted_without_alarm():
    found = check_escalation(
        [clause()], [lineage([("2022-04-01", None), ("2023-04-01", -5.74)])]
    )
    assert found[0]["status"] == "below_promised"
    assert found[0]["severity"] == "info"


def test_a_leap_year_anniversary_does_not_read_as_a_breach():
    """366 days is an anniversary, not 1.002 years. Compounding the difference
    reports a 3% rule as permitting 3.01%, which reads as broken arithmetic."""
    found = check_escalation(
        [clause()], [lineage([("2023-04-01", None), ("2024-04-01", 3.0)])]
    )
    assert found[0]["years"] == 1.0
    assert found[0]["expected_pct"] == pytest.approx(3.0, abs=0.001)
    assert found[0]["status"] == "as_promised"


def test_two_years_between_revisions_compounds_the_promise():
    found = check_escalation(
        [clause()], [lineage([("2022-04-01", None), ("2024-04-01", 6.09)])]
    )
    assert found[0]["years"] == 2.0
    assert found[0]["status"] == "as_promised"


def test_a_cap_permits_anything_under_it():
    found = check_escalation(
        [clause(rate=5.0, basis=CAPPED)],
        [lineage([("2022-04-01", None), ("2023-04-01", 3.0)])],
    )
    assert found[0]["status"] == "within_cap"


def test_a_cap_exceeded_is_still_a_warning():
    found = check_escalation(
        [clause(rate=5.0, basis=CAPPED)],
        [lineage([("2022-04-01", None), ("2023-04-01", 9.0)])],
    )
    assert found[0]["status"] == "above_promised"


def test_an_index_linked_rule_is_not_checked_against_a_number_we_do_not_have():
    assert check_escalation(
        [{"basis": INDEXED, "rate_pct": None, "compounded": False,
          "ambiguous": False, "quote": "CPI", "char_start": 0}],
        [lineage([("2022-04-01", None), ("2023-04-01", 3.0)])],
    ) == []


def test_an_ambiguous_clause_is_never_used_as_the_baseline():
    assert check_escalation(
        [clause(ambiguous=True)],
        [lineage([("2022-04-01", None), ("2023-04-01", 3.0)])],
    ) == []


def test_a_movement_with_no_single_figure_is_not_compared():
    """Rows that moved by different amounts have no one number to hold against
    one promised rate."""
    assert check_escalation(
        [clause()], [lineage([("2022-04-01", None), ("2023-04-01", None)])]
    ) == []


def test_versions_with_no_dates_are_not_compared():
    assert check_escalation(
        [clause()], [lineage([(None, None), (None, 3.0)])]
    ) == []


def test_the_strictest_stated_rule_governs():
    found = check_escalation(
        [clause(rate=5.0), clause(rate=3.0)],
        [lineage([("2022-04-01", None), ("2023-04-01", 4.0)])],
    )
    assert found[0]["rate_pct"] == 3.0
    assert found[0]["status"] == "above_promised"


def test_breaches_are_ranked_first():
    found = check_escalation([clause()], [
        lineage([("2022-04-01", None), ("2023-04-01", 3.0)], caption="FINE"),
        lineage([("2022-04-01", None), ("2023-04-01", 9.0)], caption="OVER"),
    ])
    assert found[0]["caption"] == "OVER"


# ----------------------------------------------------------------- rendering


def test_a_project_with_no_rule_says_so_rather_than_assuming_one():
    rendered = render_escalation([], [])
    assert "No document in this project states a rule" in rendered


def test_an_index_linked_project_explains_why_it_cannot_check():
    rendered = render_escalation(
        [{"basis": INDEXED, "rate_pct": None, "compounded": False,
          "ambiguous": False, "quote": "CPI", "char_start": 0}], []
    )
    assert "not in these documents" in rendered


def test_a_breach_tells_the_model_to_quote_the_clause():
    clauses = [clause()]
    findings = check_escalation(
        clauses, [lineage([("2022-04-01", None), ("2023-04-01", 9.0)])]
    )
    rendered = render_escalation(clauses, findings)
    assert "ABOVE what the contract permits" in rendered
    assert "do not state a breach without them" in rendered
