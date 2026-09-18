# packs

One directory per contract family, holding both halves of the domain knowledge
under one version: the drafting half from draftLegal (clauses, templates,
playbook positions) and the extraction half from ContractSense (taxonomy,
sweep, conventions, examples, coverage floors, fixtures).

Packs are **versioned data that orgs subscribe to**, not seed rows copied into
org tables. draftLegal's mechanism is not taken: a re-seed skips existing keys,
so a corrected clause never reaches an org that already installed it.

The format, lint rules, quality gates and review-status lifecycle are in the
Pack format spec. First family: `logistics` — the only one where both halves
exist and correctness is already labelled, with 68 hand labels on fixture 01.

Sources: `vendor/draft-legal/apps/api/src/lib/org-seed/`,
`vendor/contractsense` obligation pack data directories.
