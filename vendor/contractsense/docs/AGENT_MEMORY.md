# Agent memory

Four tiers, two stores, one composer. This describes what the contract agent is
told before it starts working, where each part comes from, and what governs
whether it is there at all.

## The tiers

| Tier | Answers | Where it lives |
|---|---|---|
| **Working** | what is in this turn | the message stack inside the tool loop |
| **Episodic** | what happened | session summary, run episodes, project events |
| **Semantic** | what is true | project facts, document index, agent memories |
| **Procedural** | how to work here | not built — see "Not built yet" |

## The composer

`services/memory/composer.py` is the single entry point. Every route builds a
`MemoryScope` and calls `compose()` once; nothing else assembles memory.

Before it existed, the two managers never met. `AgentMemoryManager` is scoped
to `(contract_id, user_id)` and `ProjectMemoryManager` to a project, and the
only thing joining them was a route concatenating one string onto another — so
a contract chat inside a project never saw the project's facts unless the model
guessed to call `get_project_timeline`. Memory the model has to ask for is not
memory; it is a tool with a discovery problem.

### What it does

- **Resolves both stores on every surface.** A contract question about a
  sibling document is answerable without a tool call.
- **Budgets by tier, not by manager.** One `TOTAL_BUDGET_CHARS` split into tier
  reservations that release what they do not use. Overflow spends the budget in
  a declared priority order rather than truncating whichever manager ran last.
- **Labels provenance.** Every block states its tier and where it came from, so
  a stale memory can be weighed against fresh retrieval.
- **Dedupes across blocks.** A fact restated in the session summary is not sent
  twice — a duplicate makes one source look like two.

### Priority order

Spent lowest-number-first:

```
recent_turns → project_index → project_facts → kpi_context
  → session_summary → project_notes → past_runs → semantic_recall → preferences
```

`project_index` sits second, above facts: it is the only block naming which
documents exist, so without it every block below describes a project the model
cannot see. `kpi_context` sits high because it is the only block that goes
stale in minutes.

### Truncation

Blocks are cut on unit boundaries — between facts, between turns — never
mid-unit. Half a fact keeps the claim and drops the qualifier, and nothing
downstream can tell it was cut. A block that cannot fit `MIN_USEFUL_BLOCK_CHARS`
is dropped and reported rather than stubbed.

## Episodic memory

### Session summary

`services/memory/summarizer.py` folds: the prior summary and the newly-aged
messages go in, one bounded summary comes out.

The previous version was not summarization. It bullet-listed the last twelve
older messages, **appended** them to the existing summary, and capped the result
at 3500 characters *from the front* — so the summary grew monotonically until it
ate its own beginning, which was the only record of the earliest turns.

Folding runs at most once per `SUMMARY_STRIDE` messages, and reads only what has
aged out since the last fold. Any provider failure falls back to
`extractive_summary`, which protects the accumulated history and squeezes the
new material instead — the prior summary represents far more turns per character
than any single message does.

### Run episodes

One record per completed run: the question, the tool sequence **in order**,
whether evidence was found, citation count, confidence. Distinct from a chat
message, which records what was *said*; an episode records what the agent *did*.
It makes "what have we already checked on this contract?" answerable across
sessions.

## Semantic memory

### Recall

`services/memory/semantic.py` ranks by `relevance × recency`, where relevance is
cosine over stored embeddings from the shared provider.

The previous implementation loaded the twelve most recently updated records and
counted how many query tokens appeared in each string. A paraphrase — "what do
we owe them each month?" after a turn about invoicing — shares no tokens and
scored zero, so recall failed silently and looked like an empty memory rather
than a missed one.

Recency is floored at `RECENCY_FLOOR`. Unfloored decay let a two-quarter-old
exact match lose to a barely-related answer from this morning; contract
knowledge does not expire on that schedule. Age moves a memory down the ranking
but cannot push a strong match below a weak one.

There is no vector index. Recall is scoped to one `(contract_id, user_id)` pair
— tens of records — where an exact cosine is both simpler and more accurate than
an approximate index, and avoids a namespace whose lifecycle would need its own
invalidation path. Exceeding `MAX_CANDIDATES` is logged rather than silently
ranking a truncated set.

### The write gate

`is_durable_answer` — a memory is written only when the user explicitly asked,
or the answer carried validated citations at real confidence.

The old rule was that the question mentioned one of five hardcoded keywords
(`payment_terms`, `termination_terms`, `obligations`, `risk_review`,
`drafting`), which then became the key the memory **overwrote**. A contract's
"payment terms" memory was whichever answer most recently mentioned an invoice:
unreviewed, uncited, and presented to the model as a "useful remembered topic".

Writes now append rather than overwrite, and carry `origin`,
`source_contract_id`, `quote`, `confidence` and `last_verified_at` — the shape
`ProjectMemoryManager.remember_fact` already used.

### Migration

`migrate_legacy_memories` gives pre-gate rows an embedding so they are
*reachable*, and marks them `origin: "legacy"` at low confidence. It does not
promote them: they were written by the overwrite path with no provenance, and
making them indistinguishable from records that earned their place is the one
thing the migration must not do. The composer labels a mixed recall block
accordingly.

## Not built yet

- **Procedural memory.** `AgentRunStore` persists every run's trace and nothing
  reads it back. Run episodes are the substrate; mining them for which tool
  sequence resolved which kind of question is not implemented, and should be
  held to the eval gate — keep only if tool-calls-per-turn drops with no
  citation-support regression.
- **Preferences and corrections.** No durable record of the lawyer
  (jurisdiction, citation style, verbosity), and `supersede_fact` is reachable
  only from amendment detection — so a user saying "notice is 60 days, not 30"
  changes nothing durable.
- **Decay and consolidation.** Recency weighting exists in recall; TTL on
  session memories, near-duplicate consolidation, and propagating
  `needs_review` to memories derived from an amended contract do not.
- **The memory surface in the panel.** `compose()` returns structured blocks
  precisely so the UI can show what the model was told, by tier and provenance.
  Nothing renders it yet.

## Testing

```bash
make eval-gate
```

Runs without Mongo, an embeddings key, or a provider. Managers are faked at
their query surface, models and embeddings are injected, so the tests exercise
composition order, budget, fold behaviour, ranking and the gate — not a
provider's output quality.
