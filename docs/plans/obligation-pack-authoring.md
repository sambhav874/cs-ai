# Obligation packs — what goes inside one, and how to prove it works

Companion to `docs/plans/obligation-extraction-packs.md`, which specifies the *format*
(directory layout, `pack.yaml`, routing, injection, budget). This doc covers the part that was
missing: **the content**, the authoring method, and the evidence that a pack earns its tokens.

Written 2026-09-07 against `final_evaluation/datasets/kpi_contracts/`. Every example below is
quoted from a real fixture — nothing here is invented.

---

## 1. Why format was not enough

Zero packs exist. The loader is the easy half; a directory of empty templates raises recall by
nothing. The hard question is: *what can you tell an extractor about a contract family that it
cannot work out from the clause in front of it?*

The answer, from reading the fixtures: **where a single obligation's parts are scattered, and which
duties in this family carry no number at all.** Both are properties of the document family, not of
any clause. Neither is visible inside an 8,000-character batch. That is exactly the knowledge a
pack exists to carry.

## 2. A pack is a skill — with three differences

| Skill concept | Pack equivalent |
|---|---|
| `SKILL.md` frontmatter (name, description, when to load) | `pack.yaml` `match:` block — the routing signal |
| `SKILL.md` body — always loaded, kept short | `taxonomy.md` + `conventions.md` — the always-on core |
| `references/` — loaded on demand | `sweep.md` + `examples.md` — first to be truncated under budget |
| Progressive disclosure by token budget | `budget.max_context_tokens`, `taxonomy` and `conventions` never truncated |

Three differences that matter, and each one is a design constraint:

1. **The model does not choose the pack.** A classifier resolves it once at ingest and pins it.
   A model picking its own domain context is how a wrong pack silently reaches every clause.
2. **A pack is scored.** `coverage.yaml` carries floors enforced by
   `testing/backend/scripts/score_obligation_coverage.py`. A skill that does not help is clutter;
   a pack that does not help fails CI.
3. **A pack cannot instruct.** It supplies vocabulary and locations. It can never override a
   system-prompt rule, license a guess, relax verbatim quoting, or set a currency. Rendered inside
   a delimited block and framed as reference material, not commands — the same treatment source
   clauses get.

## 3. The five files, and what actually belongs in each

### `taxonomy.md` — the obligation classes this family has
The list of *kinds of duty* a reader should expect to find, especially the ones with no number.
This is the file that fixes the biggest blind spot: the coverage scorer measures quantitative
spans, so a purely qualitative duty is invisible to it and to a number-hunting prompt.

**Belongs:** class name · one-line definition · which party typically owes it · whether it usually
carries a measurement.
**Does not belong:** thresholds, currencies, party names, anything contract-specific. Those come
from the document.

### `sweep.md` — where the parts hide
Per class, the *document locations and block shapes* to check. This is the highest-value file in
the pack, because it encodes the scatter pattern that batching destroys.

**Belongs:** repeating block shapes ("Definition / Target / Measurement / Exclusions"), the fact
that a band table and its rate ladder sit in different blocks, article-level pairings (a credit
clause in Art. IV is capped in Art. VI).
**Does not belong:** "look harder", "be thorough". Non-actionable exhortation is how prompts bloat.

### `conventions.md` — how this family writes things down
Unit and cadence idioms, party vocabulary, defined-term conventions, the shape of the family's
standard regime (HIPAA BAA, cGMP, PCI-DSS) *as vocabulary*, not as an assumed fact.

**Belongs:** "on-time performance is stated monthly", "credits are expressed *per tenth of a
percentage point*, not as a flat amount".
**Does not belong:** a default currency. Ever. This is the exact line the IATA hardcodes crossed.

### `examples.md` — 3–6 worked records
Real clause → correct record, showing the *shape* decision, not the values. Truncated first under
budget, so nothing may depend on it.

### `coverage.yaml` — the floors
`span_coverage_floor`, `anchor_recall_floor`, `grounding_floor`, plus
`required_obligation_classes` with an `expect` rule per class. This turns the pack from a prompt
fragment someone hopes is helping into a testable asset.

---

## 4. Worked exemplar — `logistics_msa` (fixture 01)

Derived from `01_global_logistics_master_services_agreement.md`. 18,474 chars, 95 quantitative
spans.

### What reading the fixture actually taught

**a. One KPI's obligations are split across three block shapes.** Section 4.02 (KPI-1, L101–116) is:

- a prose definition block — `**Target:** At least 98.0% on-time pickup each calendar month.`
- a five-row band table — `Monthly Performance | Score | Consequence`, whose *Consequence* column
  carries its own duties ("Warning and root cause summary", "Tier 2 Service Credit and Corrective
  Action Plan")
- a **prose** penalty line *below* the table — `$3,000 per tenth of a percentage point below 96.5%`
  / `$7,500 per tenth ... below 94.0%`

One metric, three shapes, at least three record types (target, consequence ladder, triggered CAP
duty). A generic prompt seeing one 8,000-char batch emits the target and stops. The rate ladder in
that third shape is the miss the coverage scorer already surfaced on this fixture.

**b. Consequence tables carry rate ladders in a column.** KPI-2 (Section 4.03) puts four distinct
per-tenth rates — `$4,000`, `$9,000`, `$15,000`, `$30,000` — inside a `Service Credit` column keyed
by shipment type *and* failure band. Two key dimensions, four rows, four records.

**c. Credits are bounded elsewhere.** Section 6.02 caps aggregate monthly credits at 18% of monthly
management fees, with six carve-outs. A credit record extracted from Article IV that does not
reference the Article VI cap overstates recoverable money — the liability-regime-first rule needs
the pack to say *where* the regime lives in this family.

**d. The zero-number duties are real obligations.** Section 3.03: no detention, demurrage, storage,
redelivery, layover, reconsignment, chassis or dry-run charge may be billed unless supported by
time-stamped carrier records and approved exception codes. A negative, client-protective,
evidence-conditioned duty with no threshold. Invisible to span coverage; a genuine obligation.

### `pack.yaml`

```yaml
id: logistics_msa
version: 1
display_name: Logistics Master Services Agreement
extends: _base
fixture: final_evaluation/datasets/kpi_contracts/01_global_logistics_master_services_agreement.md
match:
  title_patterns: ["master services agreement", "logistics", "transportation services"]
  body_markers: ["on-time delivery", "EDI 214", "Critical Lane", "accessorial", "Peak Season"]
  structure: ["per_kpi_section_blocks", "band_table_with_consequence_column"]
budget:
  max_context_tokens: 1800
```

### `taxonomy.md` (abridged — the classes, in full sentences)

- **service_level_target** — a percentage or duration the provider must meet over a stated period.
  Supplier-owed. Carries a measurement.
- **banded_consequence_ladder** — a table or prose ladder mapping performance bands to credits,
  scores, or escalations. Supplier-owed. One record per row/tier.
- **per_unit_credit_rate** — a credit expressed as an amount *per unit of shortfall* (per tenth of
  a percentage point, per shipment, per day). Frequently stated in prose beneath its table.
- **triggered_remediation_duty** — a corrective action plan, RCA, or progress cadence that a band
  or event triggers. Supplier-owed, no threshold of its own, has its own deadlines.
- **recovery_cap** — an aggregate ceiling on credits, with carve-outs. Bounds every credit record.
- **reporting_cadence** — a recurring submission with a clock deadline and a required content list.
- **billing_precondition** — a charge that may not be billed absent stated evidence. Often
  negative and client-protective. **Usually carries no measurement.**
- **benchmark_or_repricing_trigger** — a condition that forces renegotiation.
- **records_retention**, **audit_right**, **termination_trigger**, **insurance_floor** — standard,
  usually qualitative, routinely missed by number-hunting extraction.

### `sweep.md` (abridged — the locations)

- KPI articles use a repeating block: `**Definition:** / **Target:** / **Measurement:** /
  **Exclusions:**`. Extract the target from **Target**, never from a band lower bound.
- **After every band table, read the next prose paragraph.** In this family the per-unit credit
  rate lives there, not in the table (fixture L116).
- The *Consequence* column of a band table is a second obligation stream — warnings, CAPs,
  executive reviews. Do not treat the column as a label on the row's credit.
- Reporting duties cluster in a Compliance/Reporting article with a clock time and a timezone
  (`by 8:00 AM Central Time`, `Every Monday by 12:00 PM`). Extract the cadence *and* the content list.
- Credit caps and bonus pools sit in a separate Corrective Action article. Resolve them before
  emitting credit records.
- Pricing articles mix a fixed monthly fee with several `per <unit>` rates in one table — compound
  pricing, one record per component.

### `conventions.md` (abridged)

- Performance is stated **monthly**; targets are percentages to one decimal.
- Credits are commonly `per tenth of a percentage point below <threshold>` — a rate, not a flat
  amount. Preserve the basis.
- Party vocabulary: supplier appears as *Provider* / *Logistics Provider* / the named entity;
  client as *Customer* / *Shipper*. **Resolve from the document; never assume.**
- Currency: resolved from the document. The pack states no default.

### `coverage.yaml`

```yaml
span_coverage_floor: 0.90     # of the fixture's 95 quantitative spans
anchor_recall_floor: 1.0
grounding_floor: 1.0
required_obligation_classes:
  - id: per_unit_credit_rate
    expect: ">=6 records; includes the $3,000 and $7,500 per-tenth rates at Section 4.02"
  - id: banded_consequence_ladder
    expect: "one record per table row across Sections 4.02-4.09"
  - id: reporting_cadence
    expect: ">=4 records (daily, weekly, monthly, quarterly)"
  - id: billing_precondition
    expect: ">=1 record for the accessorial evidence rule (Section 3.03)"
  - id: recovery_cap
    expect: "1 record; every credit record references it"
```

---

## 5. Packs differ for real — two contrasts

**`data_processing_agreement` (fixture 02).** Article V is Privacy and Security Obligations:
safeguards, security incident notice, breach notification support, subprocessor control, data
segregation, access controls. Section 1.03 is a flat prohibition on sale and secondary use. Most of
these duties carry **no number**. A pack whose taxonomy does not name them leaves the family's
entire compliance surface unextracted while span coverage looks acceptable — the clearest proof
that `taxonomy.md` is load-bearing and that span coverage alone is not a sufficient gate.

**`pharma_cdmo` (fixture 07).** One consolidated KPI performance table (Section 4.01) plus Articles
5 through 9, each repeating the same six section titles (operational protocols, preventive
maintenance, regulatory inspections, incident escalation and RCA, subcontractor oversight,
environmental) over dense prose — 60,139 chars. The family's pack is mostly `sweep.md`: the
repeated-article structure means near-identical headings recur many times, and identity must come
from article number plus content, not from the heading. Nothing in the logistics pack transfers.

---

## 6. How to author a pack (~2 hours per family, semi-automated)

1. **Mine the structure.** Heading tree, table shapes, repeating block patterns. Mechanical.
2. **Run the coverage scorer's denominator** on the fixture. The span list by kind tells you which
   quantitative shapes the family leans on (logistics: 42 percent, 27 currency, 18 per-unit).
3. **Extract with `_base` only, then read `missed_spans`.** The miss list *is* the first draft of
   `sweep.md` — each miss names a location the family hides obligations in.
4. **Read for zero-number duties by hand.** The one step that cannot be automated, and the one that
   fills `taxonomy.md`. Budget an hour.
5. **Write floors from the observed baseline**, not from ambition. A floor you cannot pass on day
   one is not a gate, it is a broken build.
6. **Ablate** (next section). If the pack does not move the number, it does not ship.

## 7. Proving a pack earns its tokens

A pack costs ~1,800 tokens on every batch of every run. It must pay for that.

**Ablation protocol.** Same fixture, same model, temperature 0, three runs each, `_base` only vs
`_base + pack`. Compare span coverage, per-class record counts against `required_obligation_classes`,
and grounding. Promote only if a class-recall gain exceeds run-to-run variance, and grounding does
not drop. Record both numbers in the pack directory as `ablation.json`.

**Why the ablation matters more than it looks:** a pack that adds vocabulary can *raise* extraction
count while *lowering* grounding — the model starts producing records the pack described rather than
records the contract contains. Watching coverage alone would score that as a win. Grounding is the
guard.

**CI.** Each pack's floors run against its fixture on every change to the pack, the system prompt,
or `kpi_manager.py`. A pack version bump that drops a floor fails. Because `contract_family`,
`pack_id`, and `pack_version` are stamped on every record (fields exist at `kpi_schema.py:705`,
currently never populated), a production recall regression is attributable to a specific pack
version.

## 8. Failure modes — how this becomes the IATA hardcode again

- **A pack that instructs.** The moment a pack says "assume", "default to", or "if unclear, use",
  it has become a hardcode with a version number. Lint for those strings at load.
- **A default currency in a pack.** The single line that caused the SEK bug. Schema-forbidden in
  `pack.yaml`; the loader rejects it.
- **A confident misclassification.** A wrong pack applied at high confidence reaches every clause.
  Below the confidence floor, load `_base` only and flag the run — never guess a family.
- **Packs growing without ablation.** Each unmeasured addition dilutes the budget and pushes real
  content out under truncation. `ablation.json` or it does not ship.
- **One pack per customer.** Families are document *types*, not accounts. Per-customer packs
  reintroduce the hardcode problem at N× the maintenance.

## 9. Sequencing

Packs are Phase 5 of `docs/plans/obligation-extraction-accuracy.md` and stay there. Landing them
earlier measures nothing: with silent loss unfixed (Phase 1) the ablation cannot distinguish a pack
that failed from a batch that was dropped, and with the obligation prompt still dead (Phase 2) the
packs would be layered onto a KPI-centric prompt they were not written for.

Order within Phase 5: loader + budget + classifier + `_base` → `logistics_msa` (richest scatter
patterns, best teaching case) → `data_processing_agreement` (proves the zero-number taxonomy path)
→ the remaining six.
