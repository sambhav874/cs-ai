# Persona test data — runbook

Five customer personas synthesised from competitor case studies (see
`docs/research/competitor-cases.md` and `docs/research/personas.md`).
Used as a stress test of the agent + UX across realistic buyer profiles.

## What gets seeded

| Persona | Slug | Industry | Contracts | Counterparties | Users |
|---|---|---|---|---|---|
| Vertex Cloud           | `vertex-cloud`         | SaaS observability      | 150 | ~80  | 4 |
| Caldera Health         | `caldera-health`       | Health SaaS             | 120 | ~70  | 4 |
| Ironbridge Industrial  | `ironbridge-industrial`| PE-backed manufacturer  | 250 | ~150 | 5 |
| Lumen Bio              | `lumen-bio`            | Series A biotech        |  80 | ~50  | 3 |
| Beacon Logistics       | `beacon-logistics`     | Mid-market 3PL          | 200 | ~120 | 4 |
| **Total** |  |  | **800** | **~470** | **20** |

Plus per persona:
- **20 templates / 106 clauses / 66 playbook positions** via `seedOrgDefaults` (Phase 0 — see `apps/api/src/lib/org-seed/`)
- **2 persona-specific playbook positions** (BAA breach notification, supplier price escalation, etc.) via `seed-persona-playbooks.ts`
- 6–12 PENDING `ApprovalInstance` rows via `seed-approvals.ts` (50 total)
- 5 anchor contracts get **real LLM-extracted clauses** via the `extract-ai` pipeline; the other ~795 get **synthetic clauses** parsed from `<h3>` headings via `seed-clauses.ts` (3,803 clauses total)
- All contracts indexed in Elasticsearch via inline `indexContract()` in seed-personas.ts
- **`onboardingCompleted: true`** in `org.settings` so admin hero users (e.g. Lumen Bio's Aria Volkov) aren't blocked by the OnboardingWizard overlay on first sign-in. Without this flag the wizard renders as a fullscreen overlay and intercepts every click — this caused 21 of 24 errors in the original Phase 1 capture sweep.

### Diligence rooms

Ironbridge Industrial includes a **"Steel RFP 2026"** diligence room with 50 supplier contracts pre-uploaded — required by demo thread `I4-rfp-diligence-room`. The room is created during the persona seed; if removed, I4's UI prelude will land on an empty diligence rooms list and the agent's cross-doc analysis won't have material to work on. Verify via `GET /api/v1/diligence` after seeding.

## Full seed sequence (idempotent)

```bash
cd apps/api

# 1. Core: orgs / users / contracts / counterparties / matters / templates
pnpm tsx --env-file=.env scripts/seed-personas.ts

# 2. Backfill ES (only needed if running into pre-existing personas with no ES rows)
pnpm tsx --env-file=.env scripts/reindex-personas.ts

# 3. Per-contract clauses — real pipeline on 5 anchors + synthetic on the rest
pnpm tsx --env-file=.env scripts/seed-clauses.ts

# 4. Persona-specific playbook positions (10 total)
pnpm tsx --env-file=.env scripts/seed-persona-playbooks.ts

# 5. WorkflowDefinitions + 50 PENDING approvals across personas
pnpm tsx --env-file=.env scripts/seed-approvals.ts

# 6. Verify the seed
pnpm tsx --env-file=.env scripts/verify-personas.ts
```

All scripts are idempotent — safe to re-run.

## Test users (password: `password123`)

```
Vertex Cloud:
  maya.chen@vertex.cloud         — General Counsel
  priya.patel@vertex.cloud       — Senior Counsel, Commercial
  david.kim@vertex.cloud         — Legal Operations Manager
  sara.nguyen@vertex.cloud       — Sales Ops Director (non-legal)

Caldera Health:
  lena.park@calderahealth.com    — General Counsel
  marcus.hall@calderahealth.com  — Privacy Officer / DPO
  aisha.yusuf@calderahealth.com  — Compliance Counsel
  tom.reilly@calderahealth.com   — Procurement Lead (non-legal)

Ironbridge Industrial:
  margaret.obrien@ironbridge-ind.com  — GC & VP Legal
  raj.sharma@ironbridge-ind.com       — Director of Procurement
  carla.mendez@ironbridge-ind.com     — Sr Contracts Manager (procurement)
  james.wright@ironbridge-ind.com     — M&A Counsel
  olivia.brennan@ironbridge-ind.com   — Plant Procurement Specialist (Akron)

Lumen Bio:
  aria.volkov@lumenbio.com       — General Counsel + Compliance
  ben.foster@lumenbio.com        — Senior Paralegal
  hideo.yamamoto@lumenbio.com    — Chief Scientific Officer (occasional)

Beacon Logistics:
  dean.whitfield@beaconlogistics.com  — General Counsel
  hannah.rivera@beaconlogistics.com   — Sr Contracts Manager (customer-side)
  chris.park@beaconlogistics.com      — Sr Contracts Manager (carrier-side)
  eli.tran@beaconlogistics.com        — Operations Compliance Counsel
```

## Test suite (the agent + UX stress test)

```bash
# from repo root
node scripts/persona-tests/run.mjs                # 66 single-shot conversations  ~100s
node scripts/persona-tests/run-personas.mjs       # 55 multi-turn conversations   ~400s
node scripts/persona-tests/sanity.mjs             # 18 sanity scenarios            ~70s
node scripts/persona-tests/ui-smoke.mjs           # 24 UI smoke checks             ~90s
node scripts/persona-tests/draft-artifact-smoke.mjs  # 5 Doc artifact UI checks    ~60s
node scripts/persona-tests/artifact-coverage.mjs     # 15 artifact-pane checks    ~150s
node scripts/persona-tests/rail-context-smoke.mjs    # 6 rail+pageContext checks   ~50s
node scripts/persona-tests/parity-check.mjs          # 13 cross-surface checks    ~120s
node scripts/persona-tests/screenshots-personas.mjs  # 5 visual walkthroughs      ~600s
```

Total: ~25 minutes for the full suite. Recommend running the API+UI tests
(everything except `screenshots-personas.mjs`) on every commit; screenshots
on a nightly cadence.

## What good looks like

| Suite | Pass rate | Latency |
|---|---|---|
| 66 single-shot      | 100% | ~5s avg per turn |
| 55 multi-turn       | 100% | ~7s avg per turn (3-turn convs ~21s end-to-end) |
| 18 sanity           | 100% | n/a |
| 24 UI smoke         | 100% | n/a |
| 15 artifact         | 100% | n/a |
| 6 rail-context      | 100% | n/a |
| 13 parity           | 100% | n/a |

If you see drift below these, the most common causes (in order):

1. **Redis AOF disk-full** — services error out silently. `df -h /` and free space.
2. **Python agents service down** — `lsof -i :8000`. Restart with `cd apps/agents && uvicorn main:app --port 8000 --reload`.
3. **API hung after code change** — `lsof -i :3001`. Restart `pnpm dev` in `apps/api`.
4. **ES out of sync after seed** — re-run `reindex-personas.ts`.
5. **Vector embeddings missing on new contracts** — clause-search degrades to keyword-only. OK for tests but degraded retrieval; queue `embed-contract` jobs to fix.

## Gotchas

- **Maya Chen exists in TWO orgs** — `maya@demo.com` (org `acme`) is the original demo account. `maya.chen@vertex.cloud` is the Vertex persona. Different users.
- **Contract IDs are cuids, not numeric.** When debugging multi-turn flows, check that the agent's `contract_get` calls use real cuids, not "c1" / "first" / etc.
- **The 5 anchor contracts** (one per persona) went through the real `extract-ai` pipeline; the other 795 have synthetic `<h3>`-parsed clauses. Don't be surprised if anchors have richer interpretation/quote text in `ContractClause.interpretation`.

## Where the data lives in code

```
apps/api/scripts/
  seed-personas.ts              ← orgs / users / contracts / counterparties / matters
  seed-clauses.ts               ← real-pipeline (5 anchors) + synth (~795)
  seed-approvals.ts             ← WorkflowDef + 50 PENDING approvals
  seed-persona-playbooks.ts     ← 2 persona-specific playbook positions per org
  reindex-personas.ts           ← ES backfill
  verify-personas.ts            ← count check + sanity

scripts/persona-tests/
  conversations.mjs             ← 66 single-shot specs
  personas/{vertex,caldera,ironbridge,lumen,beacon}.mjs
                                ← 55 multi-turn specs (11 per persona)
  lib.mjs                       ← shared login + askAgent helpers
  lib-multi.mjs                 ← multi-turn rubric + transcript writing
  run.mjs                       ← single-shot runner
  run-personas.mjs              ← multi-turn runner
  sanity.mjs                    ← 18 sanity scenarios
  ui-smoke.mjs                  ← 24 UI smoke
  draft-artifact-smoke.mjs      ← 5 Doc artifact
  artifact-coverage.mjs         ← 15 artifact (Table/Card/Doc)
  rail-context-smoke.mjs        ← 6 rail+pageContext
  parity-check.mjs              ← 13 cross-surface
  screenshots-personas.mjs      ← 5 walkthrough screenshot sets

docs/research/
  competitor-cases.md           ← Phase 1 (5 vendors, side-by-side + persona seeds)
  personas.md                   ← Phase 2 (5 orgs, full role/doc/JTBD detail)
  persona-test-report.md        ← Phase 5 (scorecard + fix list, kept up-to-date)
```

That's the whole shape. One command per script, all idempotent, all
verifiable.
