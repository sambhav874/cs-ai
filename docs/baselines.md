# Test baselines — 2026-09-18

Recorded before feature work, per the plan's Phase 0 gate. Any drop is a
regression, not noise.

## Environment caveat

The host is at **99% disk (3.7 GB free)**, so the Python dependency set was
**not** installed — it pulls `transformers`, `opencv-python-headless`,
`faiss-cpu` and `sentencepiece`, which would likely fill the disk. Numbers
below are from the tests that run without them. CI installs the full set, so
CI numbers will be higher; re-baseline there.

Also: `apps/intelligence/pyproject.toml` pins `python = ">=3.10,<=3.12"`, and
this host runs **3.13.7** — outside the supported range. CI uses 3.12.

## TypeScript — apps/api

| Suite | Result |
| --- | --- |
| Integration (`approvals`, `rbac`, `cross-org`, `audit-chain`) | **18 passed / 18** |

Against a real MongoDB single-node replica set plus Redis. This is the plan's
Prisma-to-MongoDB gate, plus the audit-chain concurrency suite added with that
fix.

## Python — testing/backend

| Metric | Value |
| --- | --- |
| Passed | **550** |
| Skipped | 8 |
| Failed | 1 |
| Collection errors | 16 |

All 17 problems are the same missing-dependency chain (`fitz`/PyMuPDF,
`fastapi`), not logic failures. Before the config fix below this was 524
passed / 17 errors; making vendor credentials optional unlocked 26 more.

## Python — final_evaluation

| Metric | Value |
| --- | --- |
| Passed | **30** |
| Failed | 8 |
| Collection errors | 2 |

Most failures are the same dependency chain. Two are real — see below.

## Fixed while baselining

**Vendor credentials were required to boot.** `core/config.py` declared
`huggingface_token`, `groq_api_key`, `support_email_address`,
`azure_communication_connection_string` and `azure_sender_address` as
`Field(...)` — hard-required. The intelligence service could not start without
a Groq key and Azure Communication Services credentials.

That contradicts product value 6 ("your model, your keys, your
infrastructure") and the self-host promise: a no-vendor-key install could not
start the service at all, let alone parse locally with LiteParse. All five now
default to empty and fail at the point of use.

`secret_key` stays required deliberately. A signing key with a default is the
same class of defect as a seeded password — every install that never set one
would share it.

**The eval conftest never set `sys.path`.** Tests under
`final_evaluation/tests/non_functional/` import `services...` and `core...`,
which only resolved because the Makefile runs `cd apps/backend && pytest
../../final_evaluation/tests`. Tests under `functional/` each re-derive the
path themselves; the non-functional ones never did, so they passed only from
that one directory. CI runs from the repo root, so the insert now lives in the
conftest, once.

## Open finding: the scope guard is bypassed when no documents are loaded

`test_scope_guard_blocks_out_of_scope_document_access` (EV-NF-12, Multi-Tenant
Access Isolation) fails. It asks `read_document` for `unauthorized-doc-789`
while scoped to a different contract, and expects `UnauthorizedAccessError`.

It does not raise. It returns:

```python
{'summary': 'Current document context is available.',
 'document_id': '507f1f77bcf86cd799439012', 'filename': None}
```

**Not a data leak** — the unauthorized document is not returned. But the tool
silently substitutes the in-scope document and reports success, so the agent
asks for X, receives Y, and is told it worked. That can produce a confidently
mis-cited answer, which cuts against release gate 1 ("every claim is cited and
checkable").

The guard itself is correct and does raise —
`services/contract_agent/graph/tools/executor.py:217`. It only runs once
documents have been loaded. With an empty document set the fallback path
returns the context document without consulting it. Reachability in production
depends on whether the document set can be empty or the fetch can fail.

**Not fixed here.** It is agent security code, and 16 test files in that area
cannot run on this host for lack of dependencies — changing it without being
able to exercise the suite would be guessing. Fix once CI can run the full
Python set.
