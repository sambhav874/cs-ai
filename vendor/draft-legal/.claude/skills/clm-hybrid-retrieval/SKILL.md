---
name: clm-hybrid-retrieval
description: How retrieval works in draftLegal — pgvector dense + Elasticsearch BM25 + RRF fusion, the five retrieval tools (contract_search / portfolio_search / clause_search / portfolio_compare / contract_cite) and when to use which, the indexContract contract that EVERY contract-create path must call, the backfill script for one-shot recovery, and why total≠totalMatching. Invoke when the user asks about agent search, "agent can't find my contract," "portfolio query returned wrong count," ES/pgvector/RRF questions, or when adding a new contract-create path.
---

# Hybrid Retrieval

Retrieval has two storage layers, three query modes, five agent-facing tools, and one absolute rule about indexing. Get the rule wrong and 40% of contracts go invisible — that's a real bug we shipped and had to backfill.

This skill is the canonical answer for "what does the agent use to find things, and how do I keep it working?"

---

## The two storage layers

| Layer | What lives there | When it's authoritative |
|-------|------------------|------------------------|
| **PostgreSQL + pgvector** | Clause-level embeddings on `contract_clauses.embedding vector(1536)` (OpenAI text-embedding-3-large). IVFFlat index, cosine similarity. | Semantic clause search — "unusual IP ownership clauses." Truth source for clause text. |
| **Elasticsearch** | Whole-contract documents indexed by `indexContract()`. `legal_english` analyzer, dynamic templates for `keyTerms.*` / `clauseFlags.*` / `metadata.*`. | Keyword search on plainText (BM25). Structured filters (status, type, jurisdiction, value range, date range, clause flags). Faceted aggregations. |
| **(Hybrid)** | Application-layer RRF fusion (K=60) merges ES BM25 ranks with pgvector cosine ranks per contract. | Mixed queries — keyword + semantic + filters. |

**Both must be in sync.** ES indexes the contract record; pgvector indexes its clauses. A contract that's in DB but not in ES is invisible to portfolio_search. A contract that's in ES but has no embeddings is invisible to clause-similarity queries.

---

## The five agent retrieval tools — and when to use which

This is the orchestrator routing rule **A12** in plain words. Get this right and the agent picks the cheap, accurate tool. Get it wrong and it fires `clause_search` on every "list MSAs" query.

| Tool | Use when | Hits | Returns |
|------|----------|------|---------|
| **`contract_search`** | "Find the contract with Acme" — looking up a specific known contract by name/counterparty/id. | ES BM25 on title/counterparty/contract_number + simple filters. | `{ results, total, totalMatching }` paged. |
| **`portfolio_search`** | "How many MSAs expire in 60 days?" "All contracts with auto-renewal." Aggregations + structured filters across the org. | ES bool query on typed fields + facets. | `{ results, total, totalMatching, facets }`. |
| **`clause_search`** | "Show me unusual IP ownership clauses" — semantic clause-level retrieval across contracts (or within one). | pgvector cosine similarity on `contract_clauses.embedding`, group by contract_id. | `[{ contractId, clauseId, clauseType, similarity, snippet }]`. |
| **`portfolio_compare`** | "Compare these 2-10 contracts on liability and termination" — true side-by-side. | For each (contract × topic), fetches the relevant clause and returns structured cell. | `{ contracts, topics, matrix: [[{ found, quote, section }]] }` matrix. |
| **`contract_cite`** | "Show me where in <contract> it talks about X" — locate-with-evidence on a single contract. | pgvector + position metadata on a single contract. | `[{ section, quote, similarity }]` ordered. |

**The cardinal rule (orchestrator A12):**
- Specific contract by name/id/counterparty → `contract_search`
- Aggregation over the portfolio (counts, lists, filters) → `portfolio_search`
- Semantic clause hunt → `clause_search`
- Compare N contracts → `portfolio_compare` (NOT parallel `clause_search` calls — that's the bug we fixed)
- Locate evidence in one contract → `contract_cite`

---

## The indexing contract — non-negotiable

**Every contract-create path must call `indexContract()`.** No exceptions, no "we'll do it on the next save." If a contract exists in DB without a corresponding ES doc, the portfolio agent cannot see it.

We've burned ourselves on this **once** and re-fixed it during P82 coverage probe. The bug was: only `/upload` and explicit PATCH paths called `indexContract`. These paths did NOT, and ~40% of contracts were invisible:

| Path | Status pre-fix |
|------|----------------|
| `POST /contracts` (blank-create) | ❌ no indexing — also didn't set `analysisStatus: 'DONE'` |
| Bulk CSV import | ❌ no indexing on per-row create |
| Amendment-create (`POST /contracts/:id/amendments`) | ❌ no indexing on the new amendment |
| `POST /contracts/upload` | ✅ |
| `PATCH /contracts/:id` (any field change) | ✅ |
| Diligence-room batch upload | ✅ (uses `/upload` per file) |

**The fix:** add `indexContract(contract)` to every path. **The rule going forward:** when adding a new way to create a Contract row, search for `indexContract(` in the codebase, find the existing call, and copy the pattern. Treat indexing as part of the create contract — not an afterthought.

If you find historical contracts that missed indexing, run:
```bash
pnpm tsx apps/api/scripts/backfill-es-index.ts                # all orgs
pnpm tsx apps/api/scripts/backfill-es-index.ts --org=<orgId>  # one org
pnpm tsx apps/api/scripts/backfill-es-index.ts --dry-run      # preview
```

The backfill script reads from Postgres and pushes to ES; idempotent. We ran it once on Vertex Cloud (344 → 629 indexed) after closing the gap. Verify with:
```bash
curl localhost:9200/contracts/_count -H "content-type: application/json" -d '{"query":{"term":{"orgId":"<orgId>"}}}'
```
versus:
```sql
SELECT COUNT(*) FROM contracts WHERE "orgId" = '<orgId>' AND "deletedAt" IS NULL;
```
The two numbers should match.

---

## The total/totalMatching honesty rule

`contract_search` returns three numbers. Each means something different. Mixing them up is a real bug we shipped:

| Field | What it means | When LLM should read it |
|-------|---------------|------------------------|
| `results` | Array of returned contract records (page-sized). | When listing or grounding citations. |
| `total` | `results.length` — page anchor / "did we hit any?" | Almost never. Don't let the LLM treat this as a count. |
| `totalMatching` | Real `count(*)` from DB matching the query. | **Always** for "how many" / "do we have" / "are there" answers. |

**Orchestrator A11** enforces: when answering a count question, read `totalMatching`. Without that rule, the LLM sees `total: 50` (page size) and confidently says "you have 50 contracts" when the real answer is 313.

When adding new endpoints that return lists, **always** include both fields. A `count(*)` over an indexed `(orgId, status)` is cheap.

---

## RRF fusion (when to use hybrid mode)

Hybrid is the union of ES BM25 + pgvector cosine, fused with Reciprocal Rank Fusion (K=60) at the application layer.

```
hybrid_score(doc) = 1/(K + es_rank) + 1/(K + pgvector_rank)
```

Sort descending, return top N. Implementation lives in `apps/api/src/routes/search.ts` under `mode=hybrid`.

**When hybrid wins:**
- "Find contracts mentioning indemnification with high risk score" — keyword (indemnification) + structured filter (riskScore > 0.7) + the LLM might benefit from semantic neighbors.
- "Vendor agreements similar to the Acme template" — keyword (vendor) + semantic (similar to embedding of Acme's clauses).

**When hybrid loses:**
- Pure structured queries ("MSAs expiring next quarter") — bool filter is enough; vector adds noise.
- Pure semantic queries ("unusual IP clauses") — keyword adds noise; just do pgvector.

The portfolio agent already routes structured queries away from hybrid in its intent classifier. If you see `contract_search` returning weirdly-ranked results for a count-style query, suspect the agent is sending it to the wrong mode.

---

## Embedding pipeline

```
Upload → parse-document → chunk-and-index → embed-contract
                              ↓                   ↓
                          ES /clauses       pgvector contract_clauses
                          (denormalized      (per-clause embedding,
                           contract meta)    IVFFlat cosine)
```

**Workers:**
- `apps/api/src/workers/parse.worker.ts` — runs `parse-document`, `chunk-and-index`, `embed-contract` jobs.
- `legalChunkAndStore()` (in `apps/api/src/lib/legal-chunker.ts`) — clause-boundary first, sliding-window fallback for long clauses (>2K chars, maxLen=1800, overlap=360).
- `embedContractVersion(versionId)` — embeds un-embedded clauses via raw SQL `UPDATE` with pgvector literal.

**Concurrency:** `embed-contract` runs concurrency=2, 3 retries, exponential backoff. Don't crank it — OpenAI rate limits will bite.

**To re-embed a contract** (e.g. after retype): the worker has an idempotent path that only embeds clauses where `embeddedAt IS NULL`. Re-trigger by calling `queueEmbedContract(versionId)`.

---

## Adding a new retrieval tool — checklist

1. Define the **intent shape** in plain words ("locate-with-evidence on one contract"). If it overlaps with an existing tool, extend that tool instead.
2. Decide which storage layer answers the query. Keyword → ES; semantic clause → pgvector; aggregation → ES with bool filters; mixed → RRF.
3. Write the REST endpoint in `apps/api/src/routes/internal-ai.ts` (read tool — auto-execute under A2).
4. Include `totalMatching` separate from `total` if it returns lists.
5. Write the Python tool in `apps/agents/app/tools/<name>.py`.
6. Register in the LangChain tool list (description names the intent shape).
7. Add an orchestrator routing rule (A##) disambiguating from siblings.
8. Add the artifact factory with `dedupeKey`.
9. Write the probe — direct call + agent invocation + grounding check.
10. Update `BUILD_TRACKER.md` (session log + ADL if architectural).

(See `clm-agent-tool-dev` skill for the full file-by-file walkthrough.)

---

## When the agent "can't find" a contract

Symptom: user expects a contract to appear, agent says it doesn't exist or returns wrong result. Diagnose in this order:

1. **Is it in Postgres?**
   ```sql
   SELECT id, title, "orgId", "deletedAt" FROM contracts WHERE title ILIKE '%<name>%';
   ```
2. **Is it in ES?**
   ```bash
   curl localhost:9200/contracts/_search -H "content-type: application/json" \
     -d '{"query":{"match":{"title":"<name>"}},"_source":["title","orgId"]}'
   ```
3. **If in DB but not ES:** indexing path missed. Run the backfill script for that org. Then find the create path that produced the contract and wire `indexContract`.
4. **If in both but agent still can't find it:** check `orgId` scoping — agent might be querying with wrong org context. Look for `x-org-id` in the request headers logged by the API.
5. **If filters are wrong:** look at the `tool_call_start` event in the stream — what filters did the LLM pass? It might have over-constrained (`status: 'EXECUTED'` when the user wanted any status). Routing rule may need tightening.

---

## Common questions

**Q: Should I add a vector index on the contract row (not the clauses)?**
A: No. We deliberately embed at the clause level. Document-level embeddings are too coarse for the queries our users ask. See ADL 2026-03-18 ("Clause-level embeddings, not document-level"). If you find a use case that genuinely wants whole-doc vectors, raise it as a Decision Queue item in `docs/33-AGENT-UPDATES-PLAN.md` first.

**Q: Why not use a vector DB like Pinecone / Weaviate?**
A: pgvector is good enough at our scale (1k–10k contracts/org), keeps everything in one DB (transactional consistency with the contract row), and avoids the operational cost of a second store. Revisit if we hit >100k contracts/org or need ANN queries that pgvector's IVFFlat can't serve at the latency budget.

**Q: Should the LLM read embeddings directly?**
A: No. Embeddings are an internal substrate. The LLM reads the **results of search tools** (clause text, contract metadata, structured cells). Never expose `[0.0234, -0.0891, ...]` to the LLM — it's noise to it.

**Q: What's the difference between `keyTerms`, `metadata._typeFields`, `metadata[fieldKey]`, and `metadata._aiFindings`?**
A: Four distinct buckets (see ADL 2026-03-19):
  1. `contract.keyTerms` — 14 generic fields for all contract types (parties, dates, value, governing_law, …)
  2. `contract.metadata._typeFields` — type-specific expert fields (NDA: mutual, permitted_use; SOW: deliverables, milestones; …)
  3. `contract.metadata[fieldKey]` — org admin-defined custom fields
  4. `contract.metadata._aiFindings` — open-ended LLM observations outside any defined schema
ES dynamic templates index `keyTerms.*`, `metadata.*`, `clauseFlags.*` automatically. All four are filterable.

---

## Files cheat sheet

| Need | File |
|------|------|
| Index a contract to ES | `apps/api/src/lib/elasticsearch.ts` → `indexContract(contract)` |
| ES query builder | `apps/api/src/lib/elasticsearch.ts` → `buildESQuery(orgId, filters)` |
| Advanced search routing | `apps/api/src/routes/search.ts` (`/advanced`, `/facets`, `/ask`) |
| pgvector clause search | `apps/api/src/lib/embeddings.ts` → `searchClauses(query, orgId, limit, contractId?)` |
| Embed worker | `apps/api/src/workers/parse.worker.ts` (`embed-contract` handler) |
| Legal chunker | `apps/api/src/lib/legal-chunker.ts` |
| Contract create paths | grep `prisma.contract.create(` in `apps/api/src/routes/` |
| Backfill script | `apps/api/scripts/backfill-es-index.ts` |
| Portfolio agent | `apps/agents/app/agents/portfolio_agent.py` |
| Ask agent (RAG) | `apps/agents/app/agents/ask_agent.py` |
| Orchestrator rules | `apps/agents/app/orchestrator.py` (A11 = totalMatching, A12 = routing) |
