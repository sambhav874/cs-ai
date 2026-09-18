# ContractSense Agent Eval Dataset Datasheet

## Motivation

The dataset exists to test real ContractSense agent behavior before public
release: factuality, citations, side effects, security, legal reasoning, and
reproducibility.

## Composition

Fixtures contain synthetic contracts, amendments, invoices, KPI records,
attachments, prompts, expected facts, citation references, forbidden strings,
side-effect expectations, and standards mappings.

## Visibility Policy

- `public`: representative cases safe to publish.
- `private`: active release-gate holdout cases. Do not commit public gold
  answers.
- `retired`: former holdout cases that can be published after replacement.

## Collection Process

Initial cases are synthetic and deterministic. Future cases should be derived
from anonymized failure modes, not customer documents, unless explicit approval
and redaction have been completed.

## Recommended Use

Run `smoke` on PRs, `security` on every public-release candidate, `full`
nightly, and `benchmark` for external BitGN/PAC comparisons.
