# Testing

This folder groups test, evaluation, and benchmark material that does not need
to live inside the application source tree.

## Layout

- `backend/tests`: backend pytest tests.
- `backend/evals`: ContractSense agent eval fixtures, scorers, and docs.
- `backend/scripts`: backend benchmark/evaluation runners.
- `backend/app-cache`: moved generated cache for backend testing support code.
- `backend/manual`: older manual test scripts that are not part of automated pytest.
- `e2e`: Cypress config and browser tests.
- `benchmarks/kaggle`: Kaggle benchmark definitions, task files, and run outputs.

## Common Commands

```bash
cd apps/backend
TESTING=true poetry run pytest ../../testing/backend/tests
```

```bash
npm run test:e2e
```
