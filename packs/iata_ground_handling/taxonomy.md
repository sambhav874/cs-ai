# Obligation classes in an SGHA

Ground handling agreements are **priced**, not scored: most of the document is rate schedules, and
the duties sit inside them. Classes marked **no number** are invisible to quantitative coverage and
are the ones most often lost.

- **turnaround_rate** — a fixed charge per turnaround, usually banded by aircraft type or MTOW.
  Airline pays. One record per band.
- **per_unit_service_rate** — a rate keyed to a unit (per hour, per attempt, per operation, per
  flight, per litre, per application). The bulk of Annex B. One record per row.
- **nil_charge_service** — a service listed at `FREE`, `at cost`, `centralized`, or `on request`.
  A duty to provide with no charge is a duty. **No number**; dropped by number-hunting extraction.
- **labour_rate_matrix** — hourly rates by position, multiplied by shift class (straight, overtime,
  holiday). Handler charges. One record per position, with the multipliers as components.
- **pass_through_disbursement** — a third-party fee the handler outlays and rebills, often with an
  administration percentage on top, and often billed by a named third party.
- **conditional_charge_rule** — a rate that varies with circumstance: technical landing at a
  percentage of the standard rate, ramp return with or without load change, fluid type. Carries a
  condition, not just an amount.
- **scope_inclusion_or_exclusion** — which Annex A sections a rate covers, and what is billed
  separately. Governs every rate record around it. **Usually no number.**
- **service_level_target** — a time or percentage against a stated measurement window
  (per turnaround, monthly, calendar year). Handler owes. Includes zero targets.
- **service_credit_for_breach** — a credit keyed to a described breach, in a table separate from the
  targets it punishes.
- **staffing_minimum** — minimum manning per turnaround or dedicated station allocation.
- **rate_escalation_rule** — indexation on an anniversary, often an index with a floor, often
  compounding. Governs every rate in the document.
- **liability_cap** — a per-incident ceiling, frequently banded by aircraft type, and separate from
  the insurance floor.
- **insurance_floor** · **payment_term** · **notice_and_termination** · **audit_or_review_milestone**
  — standard, mostly **no number** beyond a period, routinely missed.
