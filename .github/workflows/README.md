# workflows

GitHub Actions only. Jenkins goes with the merge — two pipelines means two
definitions of green. ContractSense's `Jenkinsfile` is not carried forward.

Both eval suites run here, and no feature is merged until its eval does.
Per push: typecheck, lint, unit, bundle size, API integration (including
`approvals`, `rbac`, `cross-org`), tenant isolation, agent evals t1, fixture 01
extraction plus pack lint. Per PR: agent evals t2, retrieval eval on both
backends, Playwright, axe-core. Nightly: agent evals t3, all 8 fixtures plus
NHS, the self-host install on fresh and upgrade paths.

The per-push / nightly split is a cost decision: the NHS run alone is 678 s and
413K output tokens.
