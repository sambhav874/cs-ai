# Test baselines — 2026-09-18

Recorded before feature work, per the plan's Phase 0 gate. Every suite is green.
Any drop from these numbers is a regression, not noise.

| Suite | Passed | xfail (strict) | Skipped | Failed |
| --- | --- | --- | --- | --- |
| `apps/api` integration — approvals, rbac, cross-org, audit-chain | **18** | — | — | 0 |
| `testing/backend` | **810** | 12 | 4 | 0 |
| `final_evaluation` | **83** | 3 | 4 (live) | 0 |

TypeScript runs against a real MongoDB single-node replica set plus Redis.
Python runs on 3.12.10 with the full Poetry dependency set, `TESTING=1`.

## How to reproduce

```bash
cd apps/intelligence
uv venv --python "$(readlink -f "$(command -v python3.12)")" .venv
poetry install --no-root
cd ../..
export TESTING=1 SECRET_KEY=local-only CELERY_BROKER_URL=redis://localhost:6379/0 \
       MONGODB_URI=mongodb://localhost:27017/csai_test
apps/intelligence/.venv/bin/python -m pytest testing/backend/tests -q
apps/intelligence/.venv/bin/python -m pytest final_evaluation/tests -q
```

`uv venv` rather than `poetry env use`: see the interpreter finding below.

## xfail entries are strict and tracked

**12 in `test_deep_contract_agent.py`** assert a superseded agent shape —
methods that no longer exist (`_verified_finish`), renamed trace steps
(`react_model_step`). ContractSense commit `38c3835` reads *"repair eight of
the twenty stale deep-agent tests"*; these are the twelve never repaired.

**3 in `final_evaluation`**: two import `_validate_citations` from
`middleware`, which moved when citation parsing was consolidated into
`citations.py`; one expects `create_tabular_review` to wait for approval, but
the deep agent now refuses it outright as outside the tool boundary. Nothing is
written either way, so release gate 4 holds — the assertion describes the old
design.

`strict=True` on all of them: a repair makes the run fail until the entry is
removed, so the marker cannot silently outlive the problem.

## Live-model evals are opt-in

`test_live_*` call a real provider. Unset, they reached the provider with an
empty key and got 401 — nothing billed, but a network call from a unit run.
Now skipped unless `RUN_LIVE_EVALS=1`, which only `nightly-evals.yml` sets.

## Fixed to get here

**The Python constraint excluded every real 3.12 release.** `pyproject.toml`
said `python = ">=3.10,<=3.12"`. Poetry reads `<=3.12` as `<=3.12.0`, so
3.12.1 through 3.12.10 were all rejected and the only interpreter that
qualified was a pre-release. On this host Poetry silently chose **3.12.0a5, a
February 2023 alpha**, whose C API lacks `_PyErr_GetRaisedException` — so
`pydantic_core` failed to load. CI would have failed too: `setup-python '3.12'`
installs the latest 3.12.x, which Poetry refused. Now `>=3.10,<3.13`. The lock
refresh moved no package versions.

**Vendor credentials were required to boot.** `core/config.py` declared the
Groq key, HuggingFace token and Azure Communication credentials as
`Field(...)`. The intelligence service could not start without a Groq key and
an Azure account — contradicting value 6 and the self-host promise. All five
default to empty and fail at point of use. `secret_key` stays required: a
signing key with a default is the same defect class as a seeded password.

**No embeddings provider in tests.** With no Voyage key, `build_embeddings`
fell through to local HuggingFace, an optional extra that is not installed, so
the vector store could not be constructed at all. Under `TESTING=1` it now
returns a deterministic offline fake at the production Voyage dimension —
checked first, so a unit run never calls a paid API even if a key leaks into
the environment. Cleared 10 failures.

**A source scanner walked into installed packages.** A test that asserts
citation regexes live only in `citations.py` scanned `.venv/site-packages` and
flagged tokenizers in `transformers` and `idna`. It now skips virtualenvs,
`site-packages` and `node_modules`.

**`mongomock` was used but not declared.** Added to the dev group;
`test_project_memory.py` went from uncollectable to 46 passing.

**The eval conftest never set `sys.path`.** Tests under `non_functional/`
passed only when invoked from `apps/backend`, because the Makefile `cd`s there
first. The insert now lives in the conftest.

## Fixed: the scope guard was bypassed on the no-executor path

`read_document` for an out-of-scope id, with no tool executor wired, returned:

```python
{'summary': 'Current document context is available.',
 'document_id': '507f1f77bcf86cd799439012', 'filename': None}
```

A success, carrying the **in-scope** document. Not a leak — the unauthorized
document was never returned — but the model asked for X, received Y, and was
told it worked. That is how a confidently mis-cited answer gets made, against
release gate 1. It also substituted within scope: with `{A, B}` in scope, a
request for `B` came back as `A`.

The guard itself was correct (`executor.py`), but lived inline in
`_restrict_documents`, which only runs once documents are loaded. The fallback
`_default_read_observation` never consulted it. Both paths now call one
function, `authorize_requested_documents`, and the fallback reports the
document actually requested. A denial now reaches the model as a structured
`out_of_scope` observation telling it not to retry, identical to the executor
path. `test_scope_guard_fallback.py` pins all three cases.

Production passes a real executor, so exposure was limited to runners built
without one — but the fallback was a trap for any path that did.
