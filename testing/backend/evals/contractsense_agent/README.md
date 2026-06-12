# ContractSense Agent Evals

This directory contains the public-grade ContractSense agent evaluation harness.
It is product-specific, standards-mapped, security-gated, and benchmark-aware.

The public fixtures are audit examples, not the private release holdout. Keep
active release-gate cases private until they are rotated into `retired`
fixtures.

## Run

```bash
cd apps/backend
poetry run python ../../testing/backend/scripts/evaluate_contractsense_agent.py \
  --suite smoke \
  --runner core \
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
