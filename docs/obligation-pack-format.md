# Writing an obligation pack

A pack tells the extractor what a *kind* of contract contains — the classes of duty it has, where
their parts sit in the document, and how it writes numbers down. It is added to the prompt for every
clause batch of every contract it matches, so it is small, and it describes rather than commands.

Upload one as a `.zip` of five files, flat (not inside a folder):

```
pack.yaml        required   identity, routing, budget
taxonomy.md      required   the classes of obligation this family has
conventions.md   required   how this family writes units, rates, parties
sweep.md         optional   where the parts of one obligation hide
examples.md      optional   worked shapes from real clauses
coverage.yaml    optional   the floors your pack is scored against
```

`POST /api/v1/obligation-packs/validate` runs every check and returns the exact block the model
would see, without storing anything. Use it before uploading.

## `pack.yaml`

```yaml
id: widget_msa                  # lowercase, digits, underscores; matches the family id you upload
version: 1                      # bumped automatically on re-upload
display_name: Widget Master Services Agreement
extends: _base                  # inherit the family-independent baseline (recommended)
match:
  title_patterns: ["widget services agreement"]
  body_markers: ["widget throughput", "sprocket lane", "calibration window"]
budget:
  max_context_tokens: 1800      # 100–3000
```

Routing is scored, never exact. **Two distinct markers must hit** before a family is considered at
all, and a match below the confidence floor falls back to the baseline — a wrong pack reaches every
clause in the document, so the system prefers no pack to a guess. Markers are at least four
characters; short ones match everything.

## What belongs in each file

**`taxonomy.md`** — the kinds of duty, especially the ones carrying no number. Coverage scoring
counts quantitative spans, so a purely qualitative duty is invisible to it: naming those classes is
the single highest-value thing a pack does. Per class: a name, one line of definition, which party
usually owes it, whether it usually carries a measurement.

**`conventions.md`** — unit and cadence idioms, rate bases, the family's party vocabulary as *role
words*. Never entity names, never a currency.

**`sweep.md`** — document locations and block shapes. "The per-unit rate sits in the prose after the
band table, not in the table." Not "look harder".

**`examples.md`** — three to six worked clause→record shapes. Dropped first when the pack is over
budget, so nothing may depend on it.

**`coverage.yaml`** — `span_coverage_floor`, `anchor_recall_floor`, `grounding_floor`, and
`required_obligation_classes`. Set floors from what your pack actually achieves, not from ambition;
a floor you cannot pass is a broken build, not a gate.

## Rules the uploader enforces

A pack is reference data inside a prompt, not part of the prompt. These are rejected:

| Rejected | Why |
|---|---|
| `assume`, `default to`, `if unclear, use`, `when in doubt` | licenses a guess; ambiguity is `needs_review`, not a default |
| `you must`, `output only`, `act as`, `you are now` | a pack describes; the system prompt decides the task |
| `ignore the above`, `new instructions`, `regardless of the above`, `system prompt` | prompt override |
| a currency anywhere — a `currency:` key or "currency is USD" | currency is read from the contract. This was a real bug: a hardcoded default mislabelled every amount in a contract denominated in something else |
| `<SOURCES>`, `</CONTRACT_TYPE_PACK>` and other prompt delimiters | text after one would escape the pack's block and read as instruction |
| a URL | a pack is self-contained text |
| unknown `pack.yaml` keys | typos fail loudly instead of being ignored |

"Never assume a currency" is fine — the check rejects *licensing* a guess, not the word.

Negations of this kind are how a good `conventions.md` reads.

## Limits

| | |
|---|---|
| One section | 20,000 characters |
| Whole pack | 60,000 characters |
| `taxonomy.md` + `conventions.md` | must fit the token budget — they are never truncated, so they have to fit |
| Context budget | 100–3,000 tokens (1,800 default) |
| Archive | 1 MB compressed, 24 files, flat |

Over budget, `examples.md` is dropped first, then `sweep.md`.

## Scope: the account, not the project

A pack describes a *document family*, and the same family turns up in every project an account runs.
Per-project packs would mean re-uploading identical text for each one and letting two projects drift
to different versions of the same family, so scoping is automatic — your team account if you own one,
otherwise your user. There is no scope picker.

## After upload

Every extracted record is stamped with `contract_family`, `pack_id`, `pack_version` and whether the
pack was built-in or uploaded, so a change in extraction quality is traceable to a specific version
of a specific pack. `PATCH /api/v1/obligation-packs/{family_id}?enabled=false` turns a pack off
without deleting it — **including the built-in packs**, which is how you A/B whether one helps.
Turning a built-in back on restores the reviewed version, not a copy that has drifted.

A pack is not credited with an improvement until it shows one: extract the same contract with the
pack off and on and compare. Watch grounding as well as recall — a pack that adds vocabulary can
raise the record count while lowering grounding, because the model starts producing records the pack
described rather than records the contract contains.


## What the numbers actually say

Measured on the AHM 810 corpus (fixture A, 83 ground-truth rows, three runs per arm on Groq):

| | Pack off | Pack on |
|---|---:|---:|
| Row recall | 87.1% ±3.0 | 89.6% **±0.6** |
| Records naming no party | 25.0 | **2.7** |
| Typed as obligations | 20.0 | **48.0** |
| Actionable records | 67.7 | **81.3** |

Read that carefully, because it is not the result people expect. The recall difference (+2.4) is
barely outside the noise band; single-run comparisons of the same document have shown +1.2 and −7.2
and both were noise. What replicates across every run is the **shape of the register**: without a
pack a quarter of the records name nobody who owes the duty, and the model classifies a rate
schedule as a pile of metrics rather than duties.

So a pack's value here is not that it finds more. It is that it stabilises recall (±3.0 → ±0.6) and
makes the records usable. If you evaluate a pack on span coverage alone you will conclude it does
nothing and delete it.

One thing a pack demonstrably does **not** fix: `scope_and_services` — six qualitative
Included/Excluded rows — scored 0/6 in six consecutive runs, pack on and off. Naming a class in
`taxonomy.md` is not sufficient to make the model treat a zero-number row as an obligation.

## Reading order

1. `docs/obligation-pack-format.md` — this file. Format, rules, limits.
2. `apps/backend/packs/obligations/_base/` — the family-independent baseline every pack inherits.
3. `apps/backend/packs/obligations/iata_ground_handling/` — the worked example, derived from real
   SGHA documents in `sample_projects/`.
4. `docs/plans/obligation-pack-authoring.md` — why each file exists and how to author one.
5. `apps/backend/services/obligation_packs.py` — the enforcement: what is rejected and why.
