# apps

Four apps. Three are permanent; `agents/` exists to be emptied.

| App | Comes from | Tier |
| --- | --- | --- |
| `web` | draftLegal SPA (React 18 → 19), ContractSense screens ported in | frontend |
| `api` | draftLegal Fastify + Prisma (Postgres → MongoDB connector) | TypeScript |
| `intelligence` | ContractSense `apps/backend` (FastAPI, Celery, extraction/RAG/agent/DOCX) | Python |
| `agents` | draftLegal agents service — harvest, then retire | Python, temporary |

Source trees live in `vendor/` until each step of the merge runbook moves them
here with `git mv`, so the move is a reviewable commit rather than being
tangled into the import.
