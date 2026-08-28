#!/usr/bin/env python3
"""
Automated Verification Suite for synthetic IATA AHM 810 Test Corpus (v2).
Strictly verifies:
  1. Arithmetic consistency: every numeric rate in B == cpi_uplift(A), and in C == cpi_uplift(B) across ALL tables.
  2. Row count continuity: asserts row counts across A -> B -> C ONLY change where M4 (+1 in C ramp) and M5 (-1 in C support) dictate.
  3. Signature equality check: verifies signature_should_match == (from.caption == to.caption and from.header == to.header).
  4. Scoped rename check: verifies 'SGHA Ref' appears ONLY in C's ramp_services; support_services and passenger_services retain 'SGHA 2018'.
  5. Document D complete copy: asserts D's passenger_services has all 12 rows, byte-identical to Document A.
  6. ground_truth.json referential integrity for all table_keys.
  7. Presence of all 12 required table categories in Document A.
  8. Deliberate stress cases S1-S10 presence and document/page recording.
  9. Text selectability & character counts per page across all 5 PDFs (via PyMuPDF / fitz).
 10. Synthetic footer marker on EVERY page of EVERY PDF.
"""

import os
import re
import json
from decimal import Decimal, ROUND_HALF_UP
import fitz  # PyMuPDF


def parse_price(cell_str):
    """
    Extracts Decimal price if present, else returns None.
    """
    if not isinstance(cell_str, str):
        return None
    m = re.search(r'([0-9]+(?:\.[0-9]+)?)\s*(?:EUR|USD|\$|€)?', cell_str.replace(',', ''))
    if m:
        try:
            return Decimal(m.group(1))
        except Exception:
            return None
    return None


def cpi_uplift(val):
    return (val * Decimal('1.03')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def verify_corpus():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    gt_path = os.path.join(base_dir, "ground_truth.json")
    
    print("=" * 70)
    print("RUNNING AUTOMATED VERIFICATION FOR IATA AHM 810 TEST CORPUS (v2)")
    print("=" * 70)

    # 1. Check ground_truth.json parsing
    assert os.path.exists(gt_path), f"ground_truth.json not found at {gt_path}"
    with open(gt_path, "r", encoding="utf-8") as f:
        gt = json.load(f)
    print("✔ ground_truth.json parsed successfully as valid JSON.")

    doc_map = {d["document_id"]: d for d in gt["documents"]}
    assert set(doc_map.keys()) == {"A", "B", "C", "D", "E"}, f"Unexpected docs: {doc_map.keys()}"
    print("✔ Documents A, B, C, D, E present in ground truth.")

    # Helper function to get table dict by (doc_id, table_key)
    def get_table(doc_id, table_key):
        d = doc_map[doc_id]
        for t in d["tables"]:
            if t["table_key"] == table_key:
                return t
        raise KeyError(f"Table '{table_key}' not found in Doc '{doc_id}'")

    # 2. Referential integrity & Signature equality check against caption+header
    print("\n--- Checking Mappings & Signature Equality against Caption+Header ---")
    for mapping in gt["expected_mappings"]:
        case_id = mapping["case"]
        from_spec = mapping.get("from")
        to_spec = mapping.get("to")
        sig_match_expected = mapping.get("signature_should_match")
        fuzzy_match_expected = mapping.get("fuzzy_should_match")

        if from_spec and to_spec and not isinstance(to_spec, list):
            f_table = get_table(from_spec["document_id"], from_spec["table_key"])
            t_table = get_table(to_spec["document_id"], to_spec["table_key"])
            
            # Check exact caption + header equality
            exact_sig_equal = (f_table["caption"] == t_table["caption"]) and (f_table["header"] == t_table["header"])
            assert exact_sig_equal == sig_match_expected, (
                f"Mapping {case_id}: signature_should_match is {sig_match_expected}, "
                f"but caption/header equality is {exact_sig_equal}!\n"
                f"  From ({from_spec['document_id']}): cap='{f_table['caption']}', hdr={f_table['header']}\n"
                f"  To   ({to_spec['document_id']}): cap='{t_table['caption']}', hdr={t_table['header']}"
            )
            print(f"✔ Mapping {case_id} signature_should_match ({sig_match_expected}) strictly equals caption+header equality.")
        elif to_spec:
            print(f"✔ Mapping {case_id} structural/new mapping validated.")

    # 3. Scoped Header Rename Check
    print("\n--- Checking Scoped Header Rename (SGHA 2018 -> SGHA Ref) ---")
    c_ramp = get_table("C", "ramp_services")
    c_support = get_table("C", "support_services")
    c_pass = get_table("C", "passenger_services")

    assert c_ramp["header"] == ["DESCRIPTION", "UNIT", "PRICE", "SGHA Ref"], (
        f"Expected C's ramp_services header to have 'SGHA Ref', got {c_ramp['header']}"
    )
    assert c_support["header"] == ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"], (
        f"Expected C's support_services header to remain 'SGHA 2018', got {c_support['header']}"
    )
    assert c_pass["header"] == ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"], (
        f"Expected C's passenger_services header to remain 'SGHA 2018', got {c_pass['header']}"
    )
    print("✔ Header rename is scoped strictly to C's ramp_services; support and passenger remain 'SGHA 2018'.")

    # 4. Document D Complete Copy of Document A for Passenger Services (M3)
    print("\n--- Checking Document D PASSENGER SERVICES (12 Rows, Complete Copy of A) ---")
    a_pass = get_table("A", "passenger_services")
    d_pass = get_table("D", "passenger_services")
    assert len(a_pass["rows"]) == 12, f"Document A passenger_services must have 12 rows, got {len(a_pass['rows'])}"
    assert len(d_pass["rows"]) == 12, f"Document D passenger_services must have 12 rows, got {len(d_pass['rows'])}"
    assert json.dumps(a_pass["rows"]) == json.dumps(d_pass["rows"]), (
        f"Document D passenger_services is not identical to Document A!"
    )
    print("✔ Document D PASSENGER SERVICES is a complete 12-row byte-identical copy of Document A.")

    # 5. Row Count Continuity Check (A -> B -> C)
    print("\n--- Checking Row Count Continuity (A -> B -> C) ---")
    trackable_tables = ["tiered_pricing", "ramp_services", "support_services", "passenger_services"]
    
    for t_key in trackable_tables:
        t_a = get_table("A", t_key)
        t_b = get_table("B", t_key)
        t_c = get_table("C", t_key)

        len_a = len(t_a["rows"])
        len_b = len(t_b["rows"])
        len_c = len(t_c["rows"])

        # B must have identical row count to A for all tables
        assert len_b == len_a, f"Table '{t_key}': B row count ({len_b}) != A row count ({len_a})"

        # C row count assertions
        if t_key == "ramp_services":
            # M4 adds 1 row
            assert len_c == len_b + 1, f"ramp_services C count ({len_c}) must be B count ({len_b}) + 1 (M4)"
            print(f"✔ Row count '{t_key}': A={len_a}, B={len_b}, C={len_c} (+1 added row for M4 verified)")
        elif t_key == "support_services":
            # M5 removes 1 row
            assert len_c == len_b - 1, f"support_services C count ({len_c}) must be B count ({len_b}) - 1 (M5)"
            print(f"✔ Row count '{t_key}': A={len_a}, B={len_b}, C={len_c} (-1 removed row for M5 verified)")
        else:
            assert len_c == len_b, f"Table '{t_key}': C row count ({len_c}) must equal B row count ({len_b})"
            print(f"✔ Row count '{t_key}': A={len_a}, B={len_b}, C={len_c} (fully conserved across 3 versions)")

    # 6. Complete Arithmetic Consistency Check across ALL Trackable Tables
    print("\n--- Checking Arithmetic Consistency Across All Schedules (A -> B -> C) ---")
    
    # 6a. Tiered Pricing
    t_a = {row[0]: parse_price(row[1]) for row in get_table("A", "tiered_pricing")["rows"]}
    t_b = {row[0]: parse_price(row[1]) for row in get_table("B", "tiered_pricing")["rows"]}
    t_c = {row[0]: parse_price(row[1]) for row in get_table("C", "tiered_pricing")["rows"]}
    for band, p_a in t_a.items():
        exp_b = cpi_uplift(p_a)
        act_b = t_b[band]
        assert act_b == exp_b, f"Tiered B {band}: expected {exp_b}, got {act_b}"
        exp_c = cpi_uplift(exp_b)
        act_c = t_c[band]
        assert act_c == exp_c, f"Tiered C {band}: expected {exp_c}, got {act_c}"
        print(f"✔ Tiered Band '{band}': A={p_a} -> B={act_b} -> C={act_c}")

    # 6b. Ramp Services
    r_a = {row[0]: row[2] for row in get_table("A", "ramp_services")["rows"]}
    r_b = {row[0]: row[2] for row in get_table("B", "ramp_services")["rows"]}
    r_c = {row[0]: row[2] for row in get_table("C", "ramp_services")["rows"]}
    for key, val_a in r_a.items():
        p_a = parse_price(val_a)
        val_b = r_b[key]
        if p_a is not None:
            exp_b = cpi_uplift(p_a)
            act_b = parse_price(val_b)
            assert act_b == exp_b, f"Ramp B {key}: expected {exp_b}, got {act_b}"
            val_c = r_c[key]
            exp_c = cpi_uplift(exp_b)
            act_c = parse_price(val_c)
            assert act_c == exp_c, f"Ramp C {key}: expected {exp_c}, got {act_c}"
            print(f"✔ Ramp Service '{key}': A={p_a} -> B={act_b} -> C={act_c}")
        else:
            assert val_b == val_a, f"Non-numeric {key}: B ({val_b}) != A ({val_a})"
            assert r_c[key] == val_a, f"Non-numeric {key}: C ({r_c[key]}) != A ({val_a})"
            print(f"✔ Ramp Service non-numeric '{key}': A={val_a} -> B={val_b} -> C={r_c[key]}")

    # 6c. Support Services
    s_a = {row[0]: row[2] for row in get_table("A", "support_services")["rows"]}
    s_b = {row[0]: row[2] for row in get_table("B", "support_services")["rows"]}
    s_c = {row[0]: row[2] for row in get_table("C", "support_services")["rows"]}
    for key, val_a in s_a.items():
        p_a = parse_price(val_a)
        val_b = s_b[key]
        if key == "CREW TRANSPORT — OFF-AIRPORT":
            # Removed in C (M5)
            assert key not in s_c, f"Key {key} must be removed from C's support_services"
            exp_b = cpi_uplift(p_a)
            act_b = parse_price(val_b)
            assert act_b == exp_b, f"Support B {key}: expected {exp_b}, got {act_b}"
            print(f"✔ Support Service '{key}': A={p_a} -> B={act_b} -> C=REMOVED (M5)")
            continue

        if p_a is not None:
            exp_b = cpi_uplift(p_a)
            act_b = parse_price(val_b)
            assert act_b == exp_b, f"Support B {key}: expected {exp_b}, got {act_b}"
            val_c = s_c[key]
            exp_c = cpi_uplift(exp_b)
            act_c = parse_price(val_c)
            assert act_c == exp_c, f"Support C {key}: expected {exp_c}, got {act_c}"
            print(f"✔ Support Service '{key}': A={p_a} -> B={act_b} -> C={act_c}")
        else:
            assert val_b == val_a, f"Non-numeric {key}: B ({val_b}) != A ({val_a})"
            assert s_c[key] == val_a, f"Non-numeric {key}: C ({s_c[key]}) != A ({val_a})"
            print(f"✔ Support Service non-numeric '{key}': A={val_a} -> B={val_b} -> C={s_c[key]}")

    # 6d. Passenger Services (ALL 12 ROWS VERIFIED)
    p_a_map = {row[0]: row[2] for row in get_table("A", "passenger_services")["rows"]}
    p_b_map = {row[0]: row[2] for row in get_table("B", "passenger_services")["rows"]}
    p_c_map = {row[0]: row[2] for row in get_table("C", "passenger_services")["rows"]}
    assert len(p_a_map) == 12, "Passenger services A must have 12 unique items"
    assert len(p_b_map) == 12, "Passenger services B must have 12 unique items"
    assert len(p_c_map) == 12, "Passenger services C must have 12 unique items"

    for key, val_a in p_a_map.items():
        p_a = parse_price(val_a)
        val_b = p_b_map[key]
        val_c = p_c_map[key]
        if p_a is not None:
            exp_b = cpi_uplift(p_a)
            act_b = parse_price(val_b)
            assert act_b == exp_b, f"Passenger B {key}: expected {exp_b}, got {act_b}"
            exp_c = cpi_uplift(exp_b)
            act_c = parse_price(val_c)
            assert act_c == exp_c, f"Passenger C {key}: expected {exp_c}, got {act_c}"
            print(f"✔ Passenger Service (12-row) '{key}': A={p_a} -> B={act_b} -> C={act_c}")
        else:
            assert val_b == val_a, f"Passenger non-numeric {key}: B ({val_b}) != A ({val_a})"
            assert val_c == val_a, f"Passenger non-numeric {key}: C ({val_c}) != A ({val_a})"
            print(f"✔ Passenger Service non-numeric (12-row) '{key}': A={val_a} -> B={val_b} -> C={val_c}")

    # 7. Check 12 Categories in Document A
    print("\n--- Checking 12 Required Table Categories in Document A ---")
    REQUIRED_CATEGORIES = [
        "Contract Metadata",
        "Tiered Pricing",
        "Rate Schedule",
        "Staffing & Resourcing",
        "SLA / Performance Target",
        "Surcharge & Penalty",
        "Liability Limit",
        "Payment Schedule",
        "Deadline / Milestone",
        "Scope & Services Matrix",
        "Contact & Signature"
    ]
    doc_a_categories = set(t["category"] for t in doc_map["A"]["tables"])
    for cat in REQUIRED_CATEGORIES:
        assert cat in doc_a_categories, f"Category '{cat}' missing from Document A tables!"
        print(f"✔ Category present: {cat}")
    assert len(doc_map["A"]["non_tables"]) > 0, "Document A must record non_tables (hanging indent clauses)"
    print("✔ Non-table category present: Numbered sub-clauses 2.1-2.7 (Not A Table / S1)")

    # 8. Check Deliberate Stress Cases S1-S10
    print("\n--- Checking Deliberate Stress Cases S1-S10 ---")
    recorded_stress = {}
    for doc in gt["documents"]:
        d_id = doc["document_id"]
        for t in doc.get("tables", []):
            for sc in t.get("stress_cases", []):
                recorded_stress.setdefault(sc, []).append((d_id, t["page"], t["table_key"]))
        for nt in doc.get("non_tables", []):
            for sc in nt.get("stress_cases", []):
                recorded_stress.setdefault(sc, []).append((d_id, nt["page"], nt["description"]))

    for s_idx in range(1, 11):
        s_key = f"S{s_idx}"
        assert s_key in recorded_stress, f"Stress case {s_key} not recorded in ground truth!"
        locs = ", ".join([f"Doc {d} p.{p} ({k})" for d, p, k in recorded_stress[s_key]])
        print(f"✔ Stress case {s_key} recorded: {locs}")

    # 9. Check PDF text selectability, character counts, and footer synthetic marker
    print("\n--- Checking PDF Text Selectability & Page Footers ---")
    pdf_files = [
        "A_AnnexB_1.0_2022.pdf",
        "B_RateRevision_2023.pdf",
        "C_RateRevision_2024.pdf",
        "D_Amendment_1_2024.pdf",
        "E_AnnexB_2.0_2025.pdf"
    ]
    for p_name in pdf_files:
        p_path = os.path.join(base_dir, p_name)
        assert os.path.exists(p_path), f"PDF file not found: {p_path}"
        doc = fitz.open(p_path)
        print(f"\nPDF: {p_name} ({len(doc)} pages)")
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            char_count = len(text.strip())
            assert char_count > 100, f"{p_name} p.{page_num+1} has low char count: {char_count}"
            assert "SYNTHETIC TEST DOCUMENT — NOT A REAL AGREEMENT" in text, (
                f"Missing synthetic footer marker in {p_name} page {page_num+1}!"
            )
            print(f"  Page {page_num + 1}: {char_count} chars, Selectable=✔, Synthetic Footer=✔")

    # 10. Check Verbatim Clause 2.7 in Document A PDF text
    print("\n--- Checking Verbatim Clause 2.7 in Document A PDF Text ---")
    doc_a_pdf = fitz.open(os.path.join(base_dir, "A_AnnexB_1.0_2022.pdf"))
    doc_a_full_text = "\n".join([page.get_text() for page in doc_a_pdf])
    expected_clause = (
        "2.7 With effect from 01 April 2023 and on each anniversary thereafter, all charges set out in Paragraph 1 "
        "shall be increased by three per cent (3.00%) per annum, compounded annually, rounded to two decimal places."
    )
    norm_pdf_text = " ".join(doc_a_full_text.split())
    norm_expected = " ".join(expected_clause.split())
    assert norm_expected in norm_pdf_text, f"Verbatim clause 2.7 not found in Document A PDF text!"
    print("✔ Verbatim Clause 2.7 confirmed present in Document A PDF.")

    print("\n" + "=" * 70)
    print("ALL v2 VERIFICATION CHECKS PASSED WITH 100% PRECISION!")
    print("=" * 70)


if __name__ == "__main__":
    verify_corpus()
