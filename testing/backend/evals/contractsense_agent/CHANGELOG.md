# ContractSense Agent Evals Changelog

## 1.1.0 — cited Q&A (agent merge P3)

- `exact_citation_rate`: the share of emitted citations whose quote is found
  word for word (whitespace-normalised) in the cited document. Blocking, floor
  0.90. The citation guard now drops a quote it cannot find in the source; the
  runner counts every dropped citation as emitted-but-unverified, so dropping a
  fabrication lowers both rates instead of disappearing from them.
- `multi_part_completeness_rate`: over prompts that enumerate parts, the share
  whose answer addresses every part or says it was not found. Blocking, floor
  1.0. Judged with the same planner the runtime uses
  (services/contract_agent/question_plan.py).
- Cases: `public_full_nhs_five_part_question` (the NHS failure — five parts,
  part 5 deliberately absent from the synthetic contract) and
  `public_full_multi_part_payment_terms` (lettered parts).
- Recorded failing (gate 7): `test_completeness_gate_fails_when_the_runtime_skips_parts`
  runs the NHS case with the runtime's completeness pass switched off; parts
  3-5 go unanswered, completeness reads 0.0 and the gate fails on its floor.
  `test_fabricated_citation_is_marked_unverified_and_lowers_support_rate`
  failed when the guard first started dropping unsupported quotes (support read
  1.0 with nothing counted) and passes once drops are counted.

## 1.0.0

- Added public-grade eval schema, deterministic scorers, release gates, and CLI.
- Added public smoke/security fixtures mapped to NIST, OWASP, HELM, BitGN,
  LegalBench, CUAD, and ContractNLI.
- Added public benchmark card, dataset datasheet, and scoring rubric.
- Kept PAC/BitGN as benchmark layers rather than the sole product gate.
