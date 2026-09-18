# ContractSense Agent Benchmark Card

## Intended Use

Measure whether the ContractSense backend agent can answer contract questions,
ground material claims, handle KPIs and work products, and resist unsafe or
malicious instructions.

## Not Intended For

- Ranking base models in isolation.
- Proving legal advice is correct in all jurisdictions.
- Publishing private release-gate gold answers before scoring.

## Methodology

The harness combines deterministic checks inspired by HELM-style multi-metric
evaluation, BitGN-style side-effect scoring, tau-bench-style repeatability, and
OWASP/NIST security gates. Cases are mapped to standards in fixture metadata so
reports can show coverage rather than only a single score.

## Public Reporting Rules

Public reports may include methodology, aggregate scores, standard mappings,
representative traces, and retired cases. Active private holdout prompts and
gold answers should not be pushed publicly until they are replaced.
