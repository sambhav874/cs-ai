# 28 — Contract AI: plan

> **Scope**: the AI that *understands contracts* — ingestion → metadata → clauses → playbook → citations → RAG → drafting → redlining → inline edit assist.
> **Out of scope (separate plan)**: the conversational chat agent (ChatPanel).
> **Written**: 2026-04-24, after a review of Ironclad / Harvey / Evisort / Luminance / Sirion / LinkSquares / Juro / SpotDraft / Lexion / Kira / Pactly / Agiloft / ContractPodAi / DocuSign IAM / Hebbia; the current model landscape (Claude Opus 4.7, GPT-5.5, Gemini 3, open-source frontier) with evidence from ContractEval, BigLaw Bench, LegalBench, MRCR, voyage-law-2 vs OpenAI; and architecture patterns published by Anthropic, Docling, LegalBench-RAG, LeMAJ, and production teams.

---

## 1. Where we stand today (audit)

| Layer | Today | Gap |
|---|---|---|
| **Agents service** | 7 LangGraph agents on FastAPI: `review`, `ask`, `assist`, `draft`, `redline`, `approval`, `portfolio`. ~2.5 KLoC. | One default model for all; no task-tiered routing. |
| **Model registry** | Claude Opus/Sonnet/Haiku 4.6 (+ Haiku 4.5 in one spot), GPT-4o family, Gemini 1.5 + 2.0 Flash. Default: `claude-sonnet-4-6`. | Missing **Opus 4.7**, **GPT-5 / 5.5**, **Gemini 2.5 / 3**, **Mistral Large 3**, **Haiku 4.5** registered consistently. |
| **Extraction pipeline** | 3-step LangGraph: extract → validate → score. Chunked extraction (40K chars, 4K overlap) with merge logic. Source quotes per field. ~50-type clause taxonomy. Custom fields + open-ended. | Confidence is heuristic (quote-presence); no calibrated confidence score; no HITL gate keyed on confidence; no agreement-signal (run twice, flag disagreement). |
| **Embeddings** | OpenAI `text-embedding-3-large` (1536 dim), per-clause. | Not legal-tuned. **Voyage `voyage-law-2`** beats by ~6% avg, +15% on long docs. Harvey uses Voyage. |
| **Retrieval** | Elasticsearch (BM25 + keyword facets) + pgvector (dense). | No rerank step. No RRF fusion configured. No adaptive routing (single-doc vs portfolio vs long-context). |
| **OCR for scans** | Gotenberg renders PDFs to HTML; assumes digital text. Image-only PDFs fail silently. | No OCR tier. Need Mistral OCR 3 / Marker / Textract routed via confidence. |
| **Playbook** | LLM judge via `/playbook/test` — textual compare. | Playbook stored as prose HTML, not structured `must_have/must_not/bounds`. Embedding pre-filter absent. |
| **Redlining** | 3-step redline agent: extract ins/del → score vs playbook → counter-propose. | One suggested redline per change; no "least → most aggressive" variants (Ironclad's differentiator). No programmatic OOXML tracked-changes emission. |
| **Drafting** | `draft_agent` generates first pass from template + variables. `assist_agent` supports 7 click-to-invoke edits (rewrite, simplify, expand, …). | No inline / as-you-type streaming completions. No lexicon-validation post-edit (defined-term preservation). No cross-reference checker. |
| **Citations** | Source quotes per extracted field. | Not clickable; no chunk_id → bbox → PDF highlight. No span-match verification (fabricated-quote detection). |
| **Eval harness** | None. | No component evals, no E2E, no regression gating on prompt changes. **Highest-risk gap** — we can't tell if a prompt change regressed extraction quality. |
| **Observability** | Python logging to stdout. | No Langfuse / Phoenix tracing; no per-hop inputs/outputs/tokens/latency; no per-tenant cost attribution. |
| **PII / data residency** | Single-tenant SaaS posture. | No PII pre-redactor; no VPC/on-prem deployment mode; no hash-chained audit log of "who asked what, what the AI saw, what it emitted." |

**Net**: extraction + classification + basic redline + RAG Q&A all work. The gaps are in polish (eval harness, confidence calibration, citations UX), enterprise plumbing (observability, audit, PII), and differentiators (multi-version redline, inline as-you-type drafting, OCR, reranker, legal-tuned embeddings, structured playbooks).

---

## 2. Where best-in-class is

Distilled from the market scan.

### Table-stakes in 2026 (have all of these or you don't ship)

1. **Playbook-grounded redlining** — clause-level diff vs a structured playbook, with explanation.
2. **Named-agent architecture** — "Review Agent", "Redlining Agent" as user-facing concepts. ✓ we have this.
3. **Citations + "show your work"** — every AI claim resolves to a span highlighted on the original PDF.
4. **Natural-language custom extractors** — "ask a question" creates a field. (Evisort, Kira, Harvey.)
5. **Word-native review surface** — Word add-in or at minimum a high-fidelity docx emit. (Juro, Pactly, Ironclad Jurist native .docx.)
6. **Pre-trained clause library with 1,000+ types** — Kira, Evisort, SpotDraft, Sirion. We have ~50, can expand.
7. **Post-signature obligation agents** — chase renewals, covenants, SLAs.
8. **Pre-sign summary** — "here's what you're about to sign" auto-briefing.
9. **Cross-contract Q&A** — conversational portfolio interface.

### Differentiators (still white space)

1. **Multi-version redlines (least → most aggressive)** — only Ironclad. Every other product gives one answer. Strong wedge if we ship.
2. **Spreadsheet-of-documents UX** (rows = docs, cols = questions) — Hebbia Matrix, Harvey Vault. Single most-copied UX pattern of 2024-25.
3. **Real-time reasoning trace inline** — Ironclad Jurist.
4. **Obligation agents that chase owners** — Sirion's moat.
5. **Packaged domain agents as products** — ContractPodAi's Tariff Agent. Commercial wedge, not architectural.
6. **Citation-backed legal research inside the CLM** — Ironclad + Luminance / LexisNexis.

### Enterprise RFP blockers

SOC 2 Type II; data residency (EU / UK / India regions); encryption; SSO + RBAC; audit trail with immutable history; "no training on customer data" in writing; accuracy evidence (not just "90%" marketing); human-in-loop controls; playbook configurability without PS engagement; integrations (Salesforce / Workday / M365 / Slack); post-signature value; pricing transparency.

---

## 3. The five JTBDs for Contract AI

Each gets its own workstream. Each JTBD maps to (a) a user goal, (b) the AI capability, (c) current state, (d) target. This is how the plan is organised downstream.

### JTBD-A — "Read this contract for me and fill in the blanks"

**User goal**: drop a PDF → get parties, dates, value, clauses, risks, red flags, summary — in under a minute, with citations.

**AI capability**: ingest → OCR-tier → layout → clause-parse → structured JSON extraction → classify → risk score → summarise → index.

**Current**: works end-to-end for digital PDFs with basic layout. ~50-clause taxonomy. Source quotes. Chunked extraction handles 40-page docs.

**Target**:
- Scanned PDFs work equally well (OCR tier).
- Extracted fields carry **calibrated confidence** (dual-pass or dual-model agreement) → low-confidence auto-queued for review.
- 1,000+ clause taxonomy (Kira-class) via either expansion of prompts or fine-tuned classifier head.
- Tables inside contracts (pricing schedules, SLA tables) parsed into structured rows.
- Binder splitting: multi-agreement PDFs auto-split + each child extracted independently, linked by `parent_binder_id`.
- Every extracted field clickable → highlight on the PDF.

### JTBD-B — "Tell me if this clause is OK vs our playbook"

**User goal**: paste in a counterparty clause (or land on it in review) → see "preferred / acceptable / fallback / walkaway" + the specific deviation + suggested counter-language.

**AI capability**: clause-type classification → structured playbook lookup → rule-grounded LLM judge → propose counter-text.

**Current**: LLM-only compare via `/playbook/test`; playbook stored as HTML prose; redline agent scores changes vs playbook.

**Target**:
- Playbook stored as a **structured object** with `must_have[]`, `must_not[]`, `bounds{min, max}`, `variables[]` — not just prose. LLM evaluates against rules, not prose.
- Two-stage compare: embedding similarity narrows candidate playbook entries → LLM judge with quoted spans evaluates against rules.
- **Multi-version redlines** (least → most aggressive) — the Ironclad differentiator; produce 3 variants per deviation.
- Reviewer-memory: deviations previously accepted on this counterparty get suppressed next time.
- Severity-graded with grouping — payment, liability, IP tiered separately so high-value deviations surface first.

### JTBD-C — "Answer my question about this contract / my portfolio"

**User goal**: natural-language question (`"What's the notice period for termination?"` or `"Which of our MSAs have uncapped liability?"`) → faithful answer with clickable citations.

**AI capability**: RAG with hybrid retrieval + rerank + grounded-answer LLM + citation resolution.

**Current**: ES + pgvector, no rerank, no RRF fusion, no adaptive routing. `/ask` endpoint works for single-contract Q&A; `portfolio_agent` exists for cross-contract queries but no rerank.

**Target**:
- Adaptive router classifies query: single-doc QA (skip retrieval, load doc into context) vs portfolio RAG (hybrid + rerank) vs structured filter (SQL over extracted fields).
- Legal-tuned embeddings (**voyage-law-2** primary; BGE-M3 self-host fallback).
- BM25 + dense + RRF fusion → cross-encoder rerank (**voyage-rerank-2.5** or Cohere Rerank 4) → top-5-10 → Claude answerer with native Citations API.
- Citations carry `doc_id, chunk_id, page, bbox, char_offsets` so the UI can highlight the exact span on the PDF.
- Answer pipeline **verifies** each quoted span actually appears in the cited chunk — reject/retry on fabrication.

### JTBD-D — "Generate the first draft of this contract"

**User goal**: "Draft an NDA for Acme Corp, mutual, 2-year term, California law" → a first-pass contract ready for review.

**AI capability**: structured intake → template + variable render → LLM polish for jurisdiction/variable-dependent soft rewrites → defined-term lexicon validation.

**Current**: `draft_agent` renders a template with variables + optional LLM polish. Single flow.

**Target**: three **distinct** flows (per market consensus — one flow collapsed into "AI writes a contract" is what makes Copilot-style tools feel useless):
1. **Template-driven**: variables + deterministic render + soft LLM polish for variable-dependent segments. (80% of volume.)
2. **From-scratch prompt**: retrieval over own clause library + playbook → LLM composes → **validator**: defined-term lexicon consistent, cross-references resolve, numbering monotonic.
3. **From competing paper**: incoming 3rd-party paper → redline against playbook → surgical clause edits + OOXML-native tracked changes (not LLM-emitted XML). This becomes the link between JTBD-B and JTBD-D.

### JTBD-E — "Help me while I'm editing" (AI-while-typing)

**User goal**: I'm in the canvas editing a clause → AI surfaces a better rewrite / flags a playbook deviation / completes my sentence — **as I type**, not behind a button.

**AI capability**: low-latency inline suggestions streamed, bubble-menu AI, Copilot-style grey-text completion, inline deviation badges.

**Current**: `assist_agent` has 7 click-to-invoke actions (rewrite, simplify, expand, …). Synchronous, fire-and-forget. No streaming. No as-you-type completions.

**Target**:
- **Ghost-text completion** (Copilot-style): streamed inline suggestion at the cursor after ~400ms idle. Haiku 4.5 or GPT-4.1-mini for speed.
- **Inline deviation badges**: as the user writes a clause, a background worker classifies it + compares to playbook; a small badge appears in the margin when it deviates, click → focused drawer with the redline.
- **Streaming bubble-menu AI**: selecting text + invoking `✨ AI` already opens a palette; make it stream tokens from Opus 4.7 so the user sees the rewrite build.
- **Defined-term guard**: if the user edits a defined term ("Company" → "company"), the lexicon watcher flags it and offers an auto-fix.

---

## 4. Target architecture

Adapted from the reference architecture in the research, mapped onto our stack (FastAPI `agents`, Fastify `api`, Postgres+pgvector, Elasticsearch, Redis).

```
┌── INGEST ────────────────────────────────────────────────────────┐
│ Upload → scan → Doc-Splitter (VLM boundary detect for binders)  │
│   ↓                                                              │
│ For each split:                                                  │
│   OCR tier router: digital? → text extract direct               │
│                     image?   → Mistral OCR 3 (primary)          │
│                     tables?  → Textract/DocAI fallback          │
│   Layout detector (Docling)                                      │
│   Clause-boundary parser (numbered-section tree)                 │
│   PII redactor (in-VPC, if enterprise mode)                     │
│   Binder-link: master/amendment/SOW/DPA → parent_contract_id    │
└──────────────────────────────────────────────────────────────────┘
                 ↓
┌── EXTRACTION (agents service, LangGraph) ───────────────────────┐
│ Step 1  extract     (Haiku 4.5 or GPT-4.1-mini, chunked)       │
│ Step 2  validate    (Sonnet 4.6 — cross-check + normalise)     │
│ Step 3  score       (Sonnet 4.6 — risk/type/summary)           │
│ Dual-pass agreement signal → calibrated confidence per field   │
│ Below-threshold fields → HITL queue                             │
│ Every field:  { value, quote, chunk_id, bbox, confidence }      │
└──────────────────────────────────────────────────────────────────┘
                 ↓
┌── STORAGE (tenant-partitioned, ACL-enforced) ──────────────────┐
│ Postgres: contracts, versions, clauses, playbooks, users,      │
│           audit log (append-only, hash-chained)                │
│ S3/MinIO: original PDF + rendered markdown + bbox annotations  │
│ pgvector: clause embeddings (voyage-law-2)                     │
│ Elasticsearch: BM25 index, same partition scheme               │
│ All queries filter by tenant_id + matter_id + ACL at DB layer  │
└──────────────────────────────────────────────────────────────────┘
                 ↓
┌── RETRIEVAL ────────────────────────────────────────────────────┐
│ Query router (adaptive):                                        │
│   single-doc QA    → load doc into context, skip retrieval      │
│   portfolio RAG    → BM25 + dense → RRF fuse → voyage-rerank    │
│   structured filter→ SQL over extracted JSONB fields            │
│   graph traversal  → counterparty/clause-type edges (v1.2)      │
└──────────────────────────────────────────────────────────────────┘
                 ↓
┌── ORCHESTRATION (LangGraph per flow) ───────────────────────────┐
│ Review Agent        (JTBD-A)   — ingest → extract → index       │
│ Playbook Agent      (JTBD-B)   — compare clause vs structured pb│
│ Redline Agent       (JTBD-B/D) — multi-version, playbook-grnd'd │
│ Draft Agent         (JTBD-D)   — template | scratch | redline   │
│ Ask Agent           (JTBD-C)   — RAG w/ citations, single-doc   │
│ Portfolio Agent     (JTBD-C)   — cross-contract Q&A             │
│ Assist Agent        (JTBD-E)   — streaming inline completions   │
│ Obligation Agent    (v1.2)     — scan renewals, chase owners    │
│                                                                  │
│ Cheap models (Haiku 4.5 / nano / GPT-4.1-mini):                 │
│   classify, route, triage, simple transforms                    │
│ Flagship (Opus 4.7):                                             │
│   drafting, redline propose, playbook judge, nuanced QA         │
│ Per-flow budget caps, per-tenant daily cost ceilings             │
└──────────────────────────────────────────────────────────────────┘
                 ↓
┌── HUMAN-IN-LOOP ────────────────────────────────────────────────┐
│ Confidence-gated extraction queue                                │
│ Deviation review panel (already built — B.5.6 focused review)    │
│ Citation-clickable answers → bbox highlight on PDF              │
│ Accept/reject actions → eval set + production-to-training       │
└──────────────────────────────────────────────────────────────────┘
                 ↓
┌── GOVERNANCE ───────────────────────────────────────────────────┐
│ Langfuse tracing (every hop: inputs/outputs/tokens/latency)     │
│ Per-tenant cost dashboard + spend cap + rate limit              │
│ Audit log exportable for e-discovery / GDPR / EU AI Act         │
│ Eval CI: component + E2E + regression, per PR                   │
│ Model + prompt versioning (contracts.metadata._ai.version)      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Model selection matrix

The key decision: don't pick **one** model; route per task.

| Task | 1st choice | Fallback | Cost-optimised | Self-host |
|---|---|---|---|---|
| Metadata extraction (40-pg → JSON) | **Opus 4.7** (MRCR 8-needle 76%; literal JSON; BigLaw 90.9%) | Sonnet 4.6 (1M ctx GA, ~5× cheaper) | Chunked + Sonnet 4.6 with prompt caching | Qwen3-235B or DeepSeek-V3.1 |
| Clause classification (50-1000 types) | **GPT-4.1-mini** (ContractEval 0.644 F1, cheapest) | Sonnet 4.6 | Haiku 4.5 | Fine-tuned LegalBERT for hot types + LLM fallback |
| Playbook compliance | **Opus 4.7** (low hallucination, nuanced distinctions) | GPT-5.5 | Sonnet 4.6 | Mistral Large 3 |
| Drafting / surgical redline | **Opus 4.7** (prose 8.6, coherence 8.7) | GPT-5.5 | Sonnet 4.6 | Mistral Large 3 or Llama 3.3 70B |
| Grounded Q&A with citations | **Claude (Sonnet 4.6 or Opus 4.7) + native Citations API** | — | Sonnet 4.6 | Llama 3.3 70B + structured prompt |
| Portfolio retrieval (1M ctx) | **Gemini 2.5 Pro** (99.7% single-needle recall) — but only as retriever | Sonnet 4.6 w/ 1M ctx (GA) | — | — |
| Embeddings (per-clause) | **voyage-law-2** (+6-15% over OpenAI on legal; Harvey-endorsed) | voyage-3-large | text-embedding-3-large (what we have) | BGE-M3 |
| Reranker | **voyage-rerank-2.5** (+12.7% MAIR over Cohere 3.5; 32K ctx) | Cohere Rerank 4 | — | bge-reranker-v2-m3 |
| OCR (scanned contracts) | **Mistral OCR 3** (cost + layout + multilingual) | AWS Textract for tables | — | Marker + Surya |
| Ghost-text completion (Copilot) | **Haiku 4.5** (low latency, 200K ctx) or **GPT-4.1-nano** | Sonnet 4.6 | Haiku 4.5 | Qwen3-7B |
| Background clause-classify (inline badges) | **GPT-4.1-nano** (cheapest frontier) | Haiku 4.5 | — | LegalBERT (runs on CPU) |
| Triage / router classifier | **Haiku 4.5** or **GPT-4.1-nano** | — | — | DistilBERT (CPU) |

### Hard "avoid" list (from research evidence)

- **Gemini 2.5 / 3 for authoritative answers with citations** — documented "State Contamination"; 86% hallucination rate on AA-Omniscience law when it should abstain; 0.16% abstention rate. US courts have sanctioned attorneys for Gemini-fabricated citations. **Use Gemini as retriever only.**
- **Llama 3.3 70B for clause classification** — 0.39 F1 on ContractEval vs GPT-4.1's 0.64. Quality cliff.
- **Self-host anything < 70B for the reasoning slots** — quality cliff + GPU OpEx eats API savings at any volume below 200M tokens/day sustained.
- **Gemini as the "1M-context does it all" magic bullet** — single-needle recall is 99.7% but 8-needle MRCR at 1M crashes to 26.3% vs Opus 4.6's 76%. A 40-page contract extraction IS multi-needle.

### Pricing / cost reality check

- **Opus 4.7 uses a new tokenizer** — same $5/$25 per 1M but consumes ~35% more tokens for the same text. Effective cost up. Measure before committing high-volume flows.
- **Sonnet 4.6 is the workhorse** — $3/$15, 1M ctx now GA at flat pricing. This is the default for anything that's not extraction-sensitive or drafting-sensitive.
- **Haiku 4.5 is the sleeper** — $1/$5, 200K ctx, near-Opus quality on structured-output tasks per Anthropic's benchmarks. Right model for background classification and ghost-text.
- **voyage-law-2** $0.12/1M, **voyage-rerank-2.5** $0.05/1K docs. Both ~5% of total RAG cost. Trivial.
- **Prompt caching (Anthropic 90% off)** makes per-contract ingestion dramatically cheaper — cache the contract text, vary only the extraction sub-prompt.

---

## 6. Evaluation harness (the highest-risk gap today)

**Why**: today, if I change a prompt in `review_agent.py`, I have no way to tell if extraction quality regressed. That's reckless. Ship this *first* (Wave 0) so every subsequent Wave ships with a regression gate.

### Three layers

1. **Component evals** — per-task golden sets.
 - **Extraction**: 30-50 labeled contracts with per-field ground truth (parties, dates, value, governing law, 14 clause flags, top-10 custom fields). Metrics: F1, exact-match, quote-present rate.
 - **Classification**: labeled clauses across the 50-type taxonomy. Metric: F1 per type.
 - **Retrieval**: LegalBench-RAG (6,858 Q-A pairs) + our own 200-pair internal set. Metrics: recall@5, recall@10, MRR.
2. **End-to-end evals** — whole-flow quality.
 - **Drafting**: LLM-as-judge (LeMAJ method: split answer into Legal Data Points, score each) calibrated against human review.
 - **Redlining**: did the AI flag every playbook deviation in the labeled set? With what precision?
 - **Answer quality**: faithful-to-source score — does every cited span actually appear in the source?
3. **Regression harness** — every prompt / model change runs both layers as a CI gate. Metric drop > threshold blocks merge.

### Tooling

- **Langfuse** for tracing + eval execution. Self-host (MIT, Docker-compose). Already aligns with "no cross-border data" enterprise constraint.
- **Braintrust** or **LangSmith** as managed alternatives if we need eval-first UX — but Langfuse open-source covers 90% of needs.
- **lm-evaluation-harness** for public benchmark runs (LegalBench, LegalBench-RAG).

### Eval set growth

Every reviewer correction in production becomes a candidate eval example — feed "user fixed this field" back to a review queue, label it, add to golden set. This is how Ironclad / Harvey keep their evals relevant.

---

## 7. Rollout plan — waves

Same methodology as B.6: one workstream per commit, each with JTBD + market reference + verify script + screenshots. Target 4-6 weeks total if we go hard, 3 months at a steady pace.

### Wave 0 — Foundation (prereq, not visible to users)

- **C.0.1** Eval harness: Langfuse + component eval set for extraction (30 labeled contracts) + CI gate.
- **C.0.2** Model registry update: add Opus 4.7, Sonnet 4.7, Haiku 4.5, GPT-5 / 5.5, Gemini 2.5 / 3, Mistral Large 3.
- **C.0.3** Task-based model routing: `extract` → Sonnet 4.6 baseline, `draft` → Opus 4.7, `classify` → Haiku 4.5. Config + per-flow override.
- **C.0.4** Langfuse tracing middleware on every agent call.
- **C.0.5** Per-tenant cost attribution + daily cap (simple Redis counter; block LLM call if over budget).

### Wave 1 — Contract Understanding (JTBD-A)

- **C.1.1** OCR tier router: digital → direct text; scanned → Mistral OCR 3; tables → Textract fallback. Routes by PDF analysis on ingest.
- **C.1.2** Calibrated confidence: dual-pass extraction (temperature 0, slight prompt paraphrase) → disagreement score → calibrated confidence per field.
- **C.1.3** HITL queue for fields below confidence threshold: UI in review drawer with "AI is unsure — verify" badge + quick inline edit.
- **C.1.4** Clause-level bbox capture at extraction time — persist `{chunk_id, page, bbox, char_offsets}` per clause so citations can resolve to a PDF highlight.
- **C.1.5** Binder splitter: multi-agreement PDFs auto-split at ingest, each child extracted + linked via `parent_binder_id`. Already have a `detect_binder` route — promote to first-class.
- **C.1.6** Expand clause taxonomy to 200+ types (subtypes per category): liability → [liability_cap_fees, liability_cap_multiple, uncapped_liability, carveout_for_breach, …]. Lift F1 on edge cases.
- **C.1.7** Table extractor for pricing schedules / SLA tables — Textract or Docling → structured rows into `contract.metadata.tables`.

### Wave 2 — Playbook & Redlining (JTBD-B)

- **C.2.1** Structured playbook schema: `must_have[]`, `must_not[]`, `bounds{}`, `variables[]`, `preferred/acceptable/fallback/walkaway` + rationale. Migration: parse existing prose playbooks into structured form.
- **C.2.2** Two-stage playbook compare: voyage-law-2 similarity narrows to top-3 candidate entries → Opus 4.7 judge with rule-grounded output (`{rule_id, verdict, quoted_span, explanation}`).
- **C.2.3** Multi-version redline (Ironclad's wedge): for every deviation, produce **3 variants** — least-aggressive (minor hedge), moderate (clearer ask), most-aggressive (full playbook preferred text). Reviewer picks one.
- **C.2.4** Counterparty-memory: deviations previously accepted on this counterparty get suppressed (or shown grouped under "previously accepted") next time.
- **C.2.5** Severity grouping — payment / liability / IP / confidentiality tiers; high-severity surfaces first. Low-severity folded behind "Show 7 more low-risk deviations".

### Wave 3 — Grounded RAG (JTBD-C)

- **C.3.1** Migrate embeddings to **voyage-law-2**. Dual-write for a week, evaluate recall@10 vs OpenAI baseline, cut over.
- **C.3.2** Add **voyage-rerank-2.5** stage: top-50 from hybrid → rerank → top-10 to LLM.
- **C.3.3** RRF fusion: BM25 results + dense results → RRF with k=60 → rerank. Replace current cascade with proper hybrid.
- **C.3.4** Adaptive query router: cheap classifier (Haiku 4.5) sorts query into `single-doc | portfolio | structured-filter | long-context`. Route accordingly.
- **C.3.5** Native **Claude Citations API** for grounded Q&A answers — replaces our current quote-extraction pattern. Verify spans post-hoc (string-match against chunk).
- **C.3.6** Citation resolver UI: citation chip → scroll PDF viewer to page + draw bbox highlight + fade after 2s.

### Wave 4 — Drafting flows (JTBD-D)

- **C.4.1** Split the current single draft agent into three named graphs: `draft_template`, `draft_scratch`, `draft_redline_incoming`. Different prompts, different validators, different UIs.
- **C.4.2** Lexicon validator: parse defined terms from the Definitions section; on every AI-proposed edit, check all capitalised multi-word terms still exist in the lexicon.
- **C.4.3** Cross-reference resolver: `"as set forth in Section ___"` — AI edit must resolve all such references or flag them as a reviewer TODO.
- **C.4.4** Surgical clause edits: redline agent emits `{clause_id, proposed_text}` — backend applies via programmatic OOXML tracked-changes rather than LLM-emitted XML.
- **C.4.5** Word-native round-trip (feasibility v1.2 if time): emit docx with tracked changes that open cleanly in Word, round-trip back.

### Wave 5 — Drafting-while-editing (JTBD-E)

- **C.5.1** Ghost-text completion component in TipTap: after 400ms idle, stream from Haiku 4.5 given last 200 chars of context + document-level brief. Tab to accept, Esc to dismiss.
- **C.5.2** Background classifier: on each clause finalised (idle 2s), classify + compare to playbook in the background. Attach a margin badge (green / amber / red).
- **C.5.3** Bubble-menu AI streaming: current `assist_agent` invocation opens palette; wire Opus 4.7 streaming response so user sees rewrite build token-by-token.
- **C.5.4** Defined-term guard: watch edits to defined terms; offer a one-click "apply everywhere" or an inline warning.
- **C.5.5** Inline deviation drawer: click a margin badge → focused review drawer slides in from the right (already built — B.5.6). Wire playbook compare result in.

### Wave 6 — Obligation & portfolio agents (v1.2 wedge)

Sirion's moat. Not urgent for first customer demo, but the post-signature value is where Gartner weights growing.

- **C.6.1** Obligation extractor: dedicated prompt pass for `payment`, `sla`, `renewal`, `audit_rights`, `report_delivery` → structured `obligations[]` with `owner, due_date, recurrence`.
- **C.6.2** Reminder agent: daily cron walks obligations, sends notifications to `owner` + escalation chain; audit-logged.
- **C.6.3** Portfolio-level anomaly detection: "this renewal window is unusual vs peers" using per-type distributions.

### Wave 7 — Enterprise polish

- **C.7.1** PII redactor at ingest (Private AI / OpenAI open-weight) — per-tenant toggle.
- **C.7.2** Hash-chained audit log: per-LLM-call record `{tenant, user, matter, prompt, model, response, retrieved_chunks, reviewer_action}`. Exportable. Tamper-evident via prev-hash linking.
- **C.7.3** VPC deployment mode: Bedrock / Azure OpenAI / Vertex endpoints as first-class provider options behind the same `providers.py` abstraction.
- **C.7.4** SOC 2 controls documentation + vendor DPIA artefacts.

---

## 8. What I'd bet on — and what I'd pass on

### Bets (directly informed by research)

1. **Multi-version redline (C.2.3)** is the single most-differentiating feature we could ship. Only Ironclad has it; every other CLM gives one answer. Concrete demo win.
2. **Structured playbook (C.2.1)** is a one-time rewrite that unlocks everything downstream. The prose-playbook approach plateaus.
3. **voyage-law-2 + voyage-rerank-2.5 (C.3.1, C.3.2)** is low-effort, high-yield. 6-15% retrieval gain for ~$0 extra infra.
4. **Ghost-text completion (C.5.1)** is a huge perceptual quality lift — "AI writes with me" is a stronger UX than "AI helps me click a button". Haiku 4.5 latency makes it viable.
5. **Eval harness (C.0.1)** is the prereq. Everything else is risky without it.
6. **Task-routed model selection (C.0.3)** is free money. Routing extraction to Sonnet 4.6 while drafting uses Opus 4.7 cuts the biggest cost line ~40% with zero quality loss.

### Passes (at least for v1)

1. **Agent-to-agent autonomous negotiation** (Luminance Autopilot). Impressive demo, enterprise customers are ambivalent, and we'd need a dramatically more robust eval harness to ship responsibly. Revisit when we have 10x the eval surface.
2. **Matrix UX for cross-doc queries** (Hebbia / Harvey Vault) — worth it long-term, but not v1. Our global search (B.6.25) is the interim.
3. **Fully custom fine-tuned model** — the ContractEval evidence says closed frontier still beats open; fine-tuning is 10× the cost for a 1-2 F1 gain. Defer until we hit a real wall.
4. **Built-in legal research citations** (Ironclad Research Agent / Luminance + LexisNexis) — we'd need a case-law provider partnership. Defer.
5. **Workflow builder with self-serve agent creation** (Harvey Agent Builder). We have named-agent primitives; exposing them as a no-code builder is v2.
6. **Gemini anywhere in the authoritative path** — research evidence is strong enough that we shouldn't give it a critical role until Google fixes the hallucination-on-unknowns behaviour.

---

## 9. Concrete asks to proceed

1. **Approve the Wave-0 prereqs**: eval harness, model registry update, task-based routing, Langfuse, cost cap. These unblock everything else and have no product-surface risk.
2. **Confirm the model bets**: Opus 4.7 for drafting + playbook judge, Sonnet 4.6 for extraction/Q&A default, Haiku 4.5 for ghost-text + triage, voyage-law-2 + voyage-rerank-2.5 for RAG, Mistral OCR 3 for scans. Each is reversible per-flow via the config — no lock-in.
3. **Pick the Wave-1 scope slice**: at minimum OCR tier + calibrated confidence + HITL gate. Taxonomy expansion and binder splitter can slip to Wave 1.1.
4. **Confirm the skip-list**: agent-to-agent autonomous negotiation, matrix UX, custom fine-tune, legal-research citations. I'll build the infra such that these are addable later without a rewrite.

---

## 10. Links worth keeping (distilled from research)

**Product references**
- Ironclad [Jurist launch](https://www.prnewswire.com/news-releases/ironclad-launches-jurist-an-ai-powered-assistant-that-shows-its-work-302305858.html) · [Precise Redlining](https://support.ironcladapp.com/hc/en-us/articles/28661084734999-Use-AI-Precise-Redlining-to-Review-a-Contract)
- Harvey [Agent Builder](https://www.harvey.ai/blog/introducing-agent-builder) · [Vault](https://www.harvey.ai/blog/introducing-the-next-version-of-vault) · [Voyage partnership](https://www.harvey.ai/blog/harvey-partners-with-voyage-to-build-custom-legal-embeddings)
- Luminance [Autopilot](https://www.luminance.com/press/luminance-enhances-the-legal-industrys-only-100-ai-autonomous-contract-negotiation-tool-to-show-the-why-behind-every-decision-and-opens-it-to-the-entire-enterprise/)
- Sirion [Jan 2025 release](https://www.sirion.ai/library/whats-new/sirion-january-2025-product-release/) · [Gartner MQ](https://www.sirion.ai/library/reports/gartner-magic-quadrant-for-contract-lifecycle-management/)
- DocuSign [Iris launch](https://www.prnewswire.com/news-releases/docusign-ushers-in-a-new-era-of-ai-contract-agents-to-transform-business-302429981.html)

**Benchmarks + evals**
- [ContractEval (arXiv 2508.03080)](https://arxiv.org/abs/2508.03080) — CUAD-based clause risk evaluation
- [LegalBench (Stanford)](https://hazyresearch.stanford.edu/legalbench/) — 162 legal tasks
- [LegalBench-RAG (arXiv 2408.10343)](https://arxiv.org/abs/2408.10343) — 6,858 QA pairs for legal RAG
- [Harvey BigLaw Bench](https://www.harvey.ai/blog/introducing-biglaw-bench)
- [Vals AI VLAIR](https://www.vals.ai/vlair) — multi-vendor legal AI report
- [LeMAJ (NLLP 2025)](https://aclanthology.org/2025.nllp-1.23.pdf) — LLM-as-judge for legal

**Models + providers**
- [Claude Opus 4.7 what's new](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Voyage voyage-law-2](https://blog.voyageai.com/2024/04/15/domain-specific-embeddings-and-retrieval-legal-edition-voyage-law-2/) · [voyage-rerank-2.5](https://blog.voyageai.com/2025/08/11/rerank-2-5/)
- [Mistral OCR 3](https://mistral.ai/news/mistral-ocr-3)
- [MLEB legal embedding benchmark](https://deepwiki.com/isaacus-dev/mleb/2.1-legal-embedding-models)

**Architecture + patterns**
- [OpenAI contract data agent](https://openai.com/index/openai-contract-data-agent/) — prod walkthrough
- [Docling paper](https://arxiv.org/html/2501.17887v1) — layered ingest
- [Anthropic Citations API + Claude-1M GA](https://claude.com/blog/1m-context-ga)
- [Langfuse vs Phoenix vs LangSmith](https://langfuse.com/faq/all/best-phoenix-arize-alternatives)
- [BAML: structured-output false confidence](https://boundaryml.com/blog/structured-outputs-create-false-confidence)

---

*End of plan. Waiting on direction: approve waves, reorder, or push back.*
