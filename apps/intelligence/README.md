# apps/intelligence

Intelligence API: FastAPI + Celery. Owns ingestion, parsing, extraction, RAG,
the agent, the DOCX tracked-change engine, tabular review and KPI sources.
Verifies the JWT `apps/api` issues; never mints one.

Served at `/ai/*` behind nginx. Long runs stay inside the Celery worker — the
NHS extraction took 678 s, which is not an HTTP call anything should wait on.

This is where extraction quality lives, so the code stays where it was
measured: 306 obligations at ≥43% strict coverage on the NHS Standard
Contract, against draftLegal's 24 at ≥3%. It absorbs draftLegal's tool
catalogue, untrusted-input handling and Langfuse tracing from `apps/agents`.

Source: `vendor/contractsense/apps/backend`.
