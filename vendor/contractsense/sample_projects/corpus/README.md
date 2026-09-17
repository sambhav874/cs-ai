# IATA AHM 810 Synthetic Test Corpus (v2)

## Overview
This directory contains a synthetic test corpus for a contract-ingestion pipeline under the **IATA AHM 810 — Standard Ground Handling Agreement (SGHA), Simplified Procedure, Annex B**.

The corpus models the multi-year lifecycle of ground-handling agreements for one carrier at one station, designed specifically for testing:
1. **PDF Table Extraction**: Bordered, unruled, multi-page, and irregular tables.
2. **Table Classification**: Classification across 12 standardized contract table categories.
3. **Cross-Document Rate Tracking**: Longitudinal matching and arithmetic tracking across revisions and amendments.

Every number and table structure in this corpus is reproducible from stated mathematical and relational rules.

---

## Hard Constraints & Ground Rules
- **Synthetic Parties**: 
  - **Carrier**: `AEROVENTURE AIRLINES S.A.` (Fictional)
  - **Handling Company**: `NEXUS GROUND HANDLING SERVICES LTD.` (Fictional)
  - **Station**: `Athens International Airport (ATH / LGAV)`
- **Synthetic Footer**: Every page contains `SYNTHETIC TEST DOCUMENT — NOT A REAL AGREEMENT` in the footer.
- **Selectable Text**: Digitally generated vector PDFs with 100% extractable text (no raster/OCR dependency).
- **Verbatim Indexation Clause** (Document A, sub-clause 2.7):
  > *"2.7 With effect from 01 April 2023 and on each anniversary thereafter, all charges set out in Paragraph 1 shall be increased by three per cent (3.00%) per annum, compounded annually, rounded to two decimal places."*

---

## Arithmetic & Tracking Rules (v2 Updates)
1. **Indexation Formula**: `uplifted_rate = round(previous_rate * 1.03, 2)` (Commercial standard: `ROUND_HALF_UP`).
2. **Compounding Rule**: Document C rates are computed directly from Document B (`round(B * 1.03, 2)`), not from Document A.
3. **Non-Numeric Cells**: `FREE`, `centralized`, `at cost`, `on request (R)`, and word values remain unchanged.
4. **Percentages**: Percentage surcharges (e.g. `5.25%`, `25.00%`) are fixed contractual ratios and do not get index-uplifted.
5. **Row Continuity Rule**: Every row is carried forward in B and C unless a mapping case explicitly removes it. Row counts only change where M4 (`+1` row in C's ramp) and M5 (`-1` row in C's support) dictate.
6. **Scoped Column Rename (M6)**: Header `SGHA 2018` is renamed to `SGHA Ref` **only** in Document C's `ramp_services`. In `support_services` and `passenger_services`, the header remains `SGHA 2018` so M5 stays clean.
7. **Complete Copy for M3**: Document D's `passenger_services` is a complete 12-row copy of Document A's schedule with identical values.

---

## Corpus Timeline & Document Relationships

| Document | File | Effective Dates | Relationship | Purpose Tested |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `A_AnnexB_1.0_2022.pdf` | 01 Apr 2022 → 31 Mar 2025 | *Base Agreement* | Baseline schedules, all 12 table categories, stress cases S1–S10 |
| **B** | `B_RateRevision_2023.pdf` | 01 Apr 2023 → 31 Mar 2024 | `amends A` | Pure 3.00% CPI uplift, values only (M1) |
| **C** | `C_RateRevision_2024.pdf` | 01 Apr 2024 → 31 Mar 2025 | `amends B` | Compounded CPI uplift, added row (M4), removed row (M5), renamed column in ramp only (M6) |
| **D** | `D_Amendment_1_2024.pdf` | 01 Oct 2024 → 31 Mar 2025 | `amends A` | Liability update, new tiered de-icing schedule (M7), complete 12-row byte-identical table (M3) |
| **E** | `E_AnnexB_2.0_2025.pdf` | 01 Apr 2025 → 31 Mar 2028 | `supersedes A` | Restructured tables: 1→2 split and 2→1 merge (M8) |

---

## Deliberate Parser Stress Cases (S1 – S10)

| ID | Description | Document | Page | Expected Parser Behavior |
| :--- | :--- | :---: | :---: | :--- |
| **S1** | **Prose that looks tabular**: Numbered sub-clauses (2.1–2.7) with hanging indent. | **A** | Page 2 | Classified as `Not A Table` or ignored; must not create false table cells. |
| **S2** | **Column-aligned neighbours**: `RAMP SERVICES` and `SUPPORT SERVICES` on the same page with identical column x-positions, separated by 3 prose paragraphs. | **A** | Page 3 | Extracted as two separate tables, preserving intervening prose in reading order. |
| **S3** | **Merged banner cell**: Full-width title row directly spanning all table columns. | **A, B, C, D, E** | Various | Treated as a table caption/title banner rather than a data row. |
| **S4** | **Wrapped header**: Notification/signature block header wrapping party name across two lines. | **A, B, C, D, E** | Last | Preserved as a single table without being split into sub-tables. |
| **S5** | **Page-spanning table**: `PASSENGER SERVICES` breaks across page boundary with repeated header. | **A** | Pages 4–5 | Recovered as a single logical table with all rows preserved. |
| **S6** | **Unruled aligned list**: 2-column ground equipment rates without border grid lines. | **A** | Page 5 | Ground truth flags `is_ruled: false`; pipeline measured on whether it extracts aligned pairs. |
| **S7** | **Empty corner header**: Labor overtime table with blank top-left cell (`["", "Straight Time", ...]`). | **A** | Page 4 | First column recognized as row labels, remaining columns as data headers. |
| **S8** | **Ragged rows**: Scope matrix with legitimate trailing empty cells. | **A** | Page 1 | Matrix dimensions preserved without truncation of trailing blank cells. |
| **S9** | **Mixed currency and encoding**: Contains `€`, `$`, `USD`, and non-ASCII Greek (`Λεωφόρος Βασιλέως Κωνσταντίνου`) and German (`Straßburger Straße`) characters. | **A** | Page 5 | UTF-8 characters and distinct currencies extracted cleanly without mojibake. |
| **S10**| **Blank separator row**: Fully empty row separating narrow-body and wide-body turnaround services. | **A** | Page 2 | Single table preserved with empty separator row or grouped sections. |

---

## Cross-Document Mapping Cases (M1 – M8)

| Case | Document Mapping | `signature_should_match` | `fuzzy_should_match` | Test Purpose & Verification Rule |
| :--- | :--- | :---: | :---: | :--- |
| **M1** | Doc A `ramp_services` → Doc B `ramp_services` | `true` | `true` | Pure clean CPI indexation: `round(A * 1.03, 2)`. |
| **M2** | Doc B `ramp_services` → Doc C `ramp_services` | `false` | `true` | Compounded multi-year indexation with column rename `SGHA 2018` → `SGHA Ref`. |
| **M3** | Doc A `passenger_services` → Doc D `passenger_services` | `true` | `true` | Complete 12-row copy; byte-identical table data. |
| **M4** | Doc B `ramp_services` → Doc C `ramp_services` | `false` | `true` | `ELECTRIC TOWBARLESS TRACTOR` added as new row. |
| **M5** | Doc B `support_services` → Doc C `support_services` | `true` | `true` | `CREW TRANSPORT — OFF-AIRPORT` removed; headers remain `SGHA 2018`. |
| **M6** | Doc B `ramp_services` → Doc C `ramp_services` | `false` | `true` | Column renamed from `SGHA 2018` to `SGHA Ref` in ramp only. |
| **M7** | None → Doc D `deicing_services` | `false` | `false` | Tiered de-icing schedule has no predecessor; no forced match. |
| **M8** | Doc A `ramp_services` → Doc E `ramp_arrival` + `ramp_departure` | `false` | `false` | 1→2 table split and 2→1 table merge flagged for manual confirmation. |

---

## All 12 Required Table Categories in Document A

1. **Contract Metadata**: Cover Block (`table_key: "contract_metadata"`, Page 1)
2. **Tiered Pricing**: MTOW Turnaround Basic Charges (`table_key: "tiered_pricing"`, Page 2)
3. **Rate Schedule (Ramp)**: Ramp Services Rate Card (`table_key: "ramp_services"`, Page 3)
4. **Rate Schedule (Support)**: Support Services Rate Card (`table_key: "support_services"`, Page 3)
5. **Rate Schedule (Passenger)**: Passenger Services Card (`table_key: "passenger_services"`, Page 4)
6. **Staffing & Resourcing**: Staffing Allocation (`table_key: "staffing_resourcing"`, Page 4)
7. **SLA / Performance Target**: Service Level Standards (`table_key: "sla_performance"`, Page 5)
8. **Surcharge & Penalty**: Service Credits & Penalties (`table_key: "surcharge_penalty"`, Page 5)
9. **Liability Limit**: Aircraft Incident Limits (`table_key: "liability_limit"`, Page 6)
10. **Payment Schedule**: Invoicing & Settlement Schedule (`table_key: "payment_schedule"`, Page 6)
11. **Deadline / Milestone**: Contract Milestones & Audit Timetable (`table_key: "contract_milestones"`, Page 6)
12. **Scope & Services Matrix**: Annex A Included/Excluded Matrix (`table_key: "scope_and_services"`, Page 1)
