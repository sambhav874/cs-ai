# ContractSense Agent Evals

This directory contains the public-grade ContractSense agent evaluation harness.
It is product-specific, standards-mapped, security-gated, and benchmark-aware.

The public fixtures are audit examples, not the private release holdout. Keep
active release-gate cases private until they are rotated into `retired`
fixtures.

## Runners

| `--runner` | Executes | Use for |
|---|---|---|
| `agent` (default) | `DeepContractAgentRunner` → `ContractReActRuntime`, with retrieval served from the fixture documents | **The CI gate.** The only runner that exercises the production agent loop, middleware guards, and citation pipeline. |
| `core` | The legacy `ContractRAGSystem` | The side-by-side comparison that Phase 3.4's legacy deletion needs. Production no longer reaches this path (F-12). |
| `api` | A live deployment over HTTP | End-to-end checks against a real backend. |
| `bitgn` | BitGN PAC adapter boundary | Not installed by default. |

The `agent` runner injects its own `tool_executor` over the fixture sections
instead of using Mongo and Voyage, so the only external dependency is the model
API. Retrieval quality is out of scope for this harness by design — holding
retrieval constant is what makes a change in tool *selection* or citation
*support* attributable.

## The gate

`make eval-gate` needs no API key and no MongoDB. It runs the metric
computation, the regression comparator, and the whole agent path against a
scripted model, so a broken gate cannot silently pass everything.

```bash
make eval-gate
```

`make eval-agent` calls the real model and reports the seven metrics. Pass
`BASELINE=` to diff against another branch and fail on a citation-support
regression:

```bash
make eval-agent BASELINE=reports/main-baseline.json
```

The seven metrics, and which of them block a build, live in `metrics.py`. Only
`citation_support_rate` fails the build on a baseline regression; the cost
metrics are reported as warnings, because 1.2 exists to push
`model_calls_per_turn` down and a gate that failed on any movement would block
its own improvements. An absolute citation-support floor applies even with no
baseline, so a first run on a branch cannot ship a broken pipeline unmeasured.

## Multi-turn cases

A case with `follow_up_prompts` runs each turn on one session, composing the
`memory_context` between turns through the production `MemoryComposer` itself —
not a copy of its format. The harness supplies only the conversation-turn block
(it has no Mongo, so no project or semantic tier), but the preamble, headings,
provenance labels and budget are the ones a real follow-up gets.
Expectations are scored
against the **last** turn, so a follow-up leaning on a pronoun ("List them.")
only passes if conversation memory resolved it. That is the
`multi_turn_resolution_rate` metric, and the regression guard for F-02.

## Run

```bash
cd apps/backend
poetry run python ../../testing/backend/scripts/evaluate_contractsense_agent.py \
  --suite smoke \
  --runner agent \
  --output /tmp/contractsense-agent-smoke.json
```

Security smoke:

```bash
poetry run python ../../testing/backend/scripts/evaluate_contractsense_agent.py \
  --suite security \
  --runner core \
  --fail-on-hard-gate \
  --output /tmp/contractsense-agent-security.json
```

Live API mode requires an existing isolated eval backend and auth token:

```bash
CONTRACTSENSE_EVAL_API_BASE_URL=http://127.0.0.1:8000/api/v1 \
CONTRACTSENSE_EVAL_AUTH_TOKEN=... \
poetry run python ../../testing/backend/scripts/evaluate_contractsense_agent.py --runner api --suite smoke
```

To seed synthetic fixture projects/contracts directly into the backend MongoDB
before each API case, also provide the owner id that matches the auth token:

```bash
CONTRACTSENSE_EVAL_OWNER_ID=<user-object-id> \
CONTRACTSENSE_EVAL_API_BASE_URL=http://127.0.0.1:8000/api/v1 \
CONTRACTSENSE_EVAL_AUTH_TOKEN=... \
poetry run python ../../testing/backend/scripts/evaluate_contractsense_agent.py \
  --runner api \
  --suite smoke \
  --seed-api-fixtures
```

Seeded fixtures are cleaned up after each case unless `--keep-api-fixtures` is
passed.

BitGN mode is an adapter boundary. The actual PAC run must be launched from the
BitGN runtime after installing its `bitgn.vm.pcm` package and wiring the
ContractSense adapter.

## Public Pack

- `benchmark_card.md`: benchmark purpose, claims, and limitations.
- `dataset_datasheet.md`: fixture provenance, visibility policy, and rotation.
- `scoring_rubric.md`: deterministic checks and release gates.
- `fixtures/public_smoke.json`: representative public cases.
- `fixtures/private_holdout.example.json`: empty shape for private suites.

No Ragas dependency is used or required.
