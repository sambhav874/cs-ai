# Contributing to draftLegal

Thanks for being here. draftLegal is an open-source, self-hosted alternative to
Ironclad + Harvey, and it gets better with every contribution. This guide is for
**code** contributions. If you're a legal / contracts expert and want to improve
the product **without writing code**, see [CONTRIBUTING-LEGAL.md](./CONTRIBUTING-LEGAL.md).

## TL;DR

```bash
git clone https://github.com/AniketTati/draft-legal.git
cd draft-legal
pnpm dev:setup        # infra + deps + DB + seed, one command
pnpm dev              # web :5173 · api :3001 · agents :8000
```

Log in at http://localhost:5173 with `admin@demo.com` / `password123`.

## Contributor License Agreement (one-time, 30 seconds)

Before your first pull request can be merged, you'll be asked to sign our
[Contributor License Agreement](./CLA.md). **You keep the copyright to your
work** — the CLA just grants the project the rights it needs to stay both
open-source (AGPL-3.0) and sustainable (e.g., offering commercial licenses to
organizations that can't use AGPL).

It's frictionless: open a PR, and a bot will comment with a link. Reply with the
one-line confirmation it gives you, and you're signed for all future
contributions. Nothing to print, email, or install.

## Ways to contribute

- 🐛 **Fix a bug** — grab a [`good first issue`](https://github.com/AniketTati/draft-legal/labels/good%20first%20issue) or a [`help wanted`](https://github.com/AniketTati/draft-legal/labels/help%20wanted).
- ✨ **Build a feature** — a new agent tool, an integration (Slack, Google Drive), a UI improvement.
- 📝 **Improve docs** — if setup tripped you up, that's a docs PR waiting to happen.
- 💬 **Open a Discussion** — propose an idea before building something large.

**New contributor?** The best first PR is small: a `good first issue`, a docs fix,
or a test. We merge those fast and credit you in the release notes.

## Project layout

```
apps/
  web/        React 18 + Vite + Tailwind + shadcn/ui          (port 5173)
  api/        Fastify + Prisma + PostgreSQL/pgvector          (port 3001)
  agents/     Python 3.11 + FastAPI + LangGraph               (port 8000)
  marketing/  Marketing site (separate from the product app)
packages/
  types/      Shared TypeScript types + Zod schemas
docs/         Architecture, operations runbooks, design docs
```

Three services talk like this: **web → api (REST + SSE) → agents (internal API)**.
The api owns auth, RBAC, the database, and hybrid retrieval; the agents service
owns the LangGraph orchestrator and tool-calling.

## Dev workflow

1. **Branch** off `main`: `git checkout -b fix/short-description`.
2. **Make the change.** Keep PRs focused — one concern per PR.
3. **Verify locally:**
   ```bash
   pnpm typecheck      # all workspaces
   pnpm lint
   pnpm test
   ```
4. **Commit** with a clear message (`fix:`, `feat:`, `docs:`, `chore:` prefixes appreciated).
5. **Open a PR** against `main`. Describe what changed and how you tested it. Screenshots/GIFs for UI changes are gold.

## Common tasks

| Task | Command |
|---|---|
| Run everything | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Tests | `pnpm test` |
| DB migration (after schema change) | `pnpm --filter api db:migrate` |
| Prisma studio (browse the DB) | `pnpm --filter api db:studio` |
| Re-seed demo contracts | `pnpm --filter api exec tsx scripts/seed-ai-demo.ts seed` |

## Adding a new agent tool (high-leverage contribution)

The agents are a LangGraph orchestrator that routes to tools. A tool is:

1. A Python tool file in `apps/agents/app/tools/` (a `build_<name>(org_id, user_id)` factory returning a `StructuredTool`).
2. Registered in `apps/agents/app/tools/__init__.py`.
3. A routing rule in the orchestrator.
4. A REST callback in `apps/api/src/routes/internal-ai.ts` (if it reads/writes data).
5. A frontend artifact renderer (if it produces a card/table/diff).

See existing tools (`contract_search.py`, `portfolio_search.py`, `redline_propose.py`)
as templates. This is one of the most impactful things you can contribute.

## Code style

- **TypeScript:** the repo is strict; `pnpm typecheck` must pass. Prefer reusing existing
  helpers over adding new ones — grep before you write.
- **Python:** type hints required (the codebase targets 3.11+). Keep tool factories
  consistent with the `(org_id, user_id)` signature.
- **Commits:** small and focused. A reviewer should understand the PR in under a minute.

## Reporting bugs / requesting features

Open an issue with:
- What you expected vs. what happened
- Steps to reproduce (and your OS / Docker setup)
- Relevant logs (`/tmp` logs, browser console, or the api/agents output)

Security issue? Please **don't** open a public issue — email the maintainer (see repo profile).

## Code of conduct

Be kind, be constructive, assume good faith. We're all here to build something useful in the open.

---

Questions? Open a [Discussion](https://github.com/AniketTati/draft-legal/discussions). Welcome aboard. 🚀
