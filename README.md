# Unified contract platform

One platform built from draftLegal (execution layer) and ContractSense
(intelligence layer). See the Build plan doc for scope, sequencing and gates.

## Provenance

Both codebases are imported with `git subtree`, so `git log` answers where a
line came from and an upstream fix arrives through a reviewable
`git subtree pull`. See `docs/LICENSING.md`.

### `vendor/draft-legal`

- Source: https://github.com/AniketTati/draft-legal, branch `main`, commit `89382a1` (2026-08-29).
- Imported `--squash`: only the provenance marker and the upstream link are needed.
- **AGPL-3.0.** Its `LICENSE` and file headers are intact and stay that way.

### `vendor/contractsense`

- Source: https://github.com/sambhav874/contractsense, branch `chore/ingestion-branch-cleanup`.
- Imported with full history (195 commits), not squashed: this history is ours
  and the extraction work is worth bisecting.
- Base commit `dd7dcf7`, plus one snapshot commit `e7e310f` that commits work
  which had never been committed on any branch — `obligation_tiering.py`,
  `test_obligation_tiering.py`, `test_stage1_candidate_filter.py`,
  `seed_account.py` — and the pending `kpi_manager` / `kpi_schema` changes.
  Without it the obligation engine would have arrived incomplete.
- That snapshot was made in a **copy** of the source repo. The original at
  `Codes/extractor/extractor` is untouched: still on
  `chore/ingestion-branch-cleanup` at `dd7dcf7` with its 12 items still pending.
- Not imported from `main` (`fd57437`), which is 153 commits behind that branch
  and predates the Stage 1 extraction fix.
