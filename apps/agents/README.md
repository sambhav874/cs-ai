# apps/agents — temporary

draftLegal's agents service, kept only long enough to harvest three things
into `apps/intelligence`: the tool catalogue (31 tools), untrusted-input
handling (`untrusted.py`), and Langfuse tracing.

Then this directory is deleted. Its obligation extractor is not taken —
`text[:16000]` with `MAX_OBLIGATIONS = 25`, measured at 3% coverage.

It is pinned to LangChain <1.0 / LangGraph 0.6 after an unsatisfiable-dependency
break on 2026-08-06. The tools move to ContractSense's 1.x line rather than the
pinned line moving forward.

Everything here carries `TODO(merge)`. A grep for that marker is the deletion
list. Source: `vendor/draft-legal/apps/agents`. **AGPL-3.0.**
