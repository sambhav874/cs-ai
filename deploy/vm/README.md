# The dev environment

Everything happens in **Coolify**. It clones the `dev` branch onto the VM,
builds the three images there from [`docker-compose.dev.yml`](../../docker-compose.dev.yml),
and starts the stack. Deploys, logs, environment variables and rollbacks are
all in the Coolify UI; no registry, no CI deploy job.

```
git push dev ──webhook──▶ Coolify ──▶ VM: clone, docker compose build + up
                                         Caddy :443 ──▶ 127.0.0.1:8090 (web)
```

A code-only change redeploys in a few minutes, because Docker's layer cache on
the VM keeps the dependency installs. A lockfile change rebuilds that image's
install layer, which takes longer; the Python one is the slowest.

Everything is served from **one hostname**. `web` (nginx) serves the SPA and
proxies `/api` to the lifecycle API and `/intel` to the intelligence tier, so
there is no CORS and no second certificate.

## What runs

| Service | Built from | Notes |
| --- | --- | --- |
| `web` | `apps/web/Dockerfile` | nginx: the SPA plus the two proxies. Published on `127.0.0.1:8090` only. |
| `api` | `apps/api/Dockerfile` | Fastify lifecycle API. `WORKERS_ENABLED=false` — it must not drain the queue. |
| `jobs` | same image as `api` | BullMQ workers, renewal and obligation scans. |
| `migrate` | same image as `api` | One-shot `prisma db push` before the API starts. |
| `intelligence` | `apps/intelligence/Dockerfile` | FastAPI. |
| `worker` | same image as `intelligence` | Celery. |
| `minio-init` | `minio/mc` | Creates the bucket; MinIO will not create one on first PUT. |
| `mongo` | `mongo:7` | Single-node **replica set** — Prisma needs one for transactions, the Space watcher for change streams. Self-initiating on first boot. |
| `redis`, `minio`, `gotenberg` | — | Queue, object store, HTML→PDF. |

## Why Caddy and not Coolify's proxy

The VM's host Caddy already owns ports 80/443 and serves the old draftLegal
demo, so Coolify's Traefik cannot bind them. Coolify therefore only builds and
runs the stack; Caddy routes the public hostname to `127.0.0.1:8090`:

```
cs.187-7-17-249.sslip.io {
	encode gzip
	reverse_proxy 127.0.0.1:8090
}
```

Coolify also expects a Docker network called `coolify`, which Traefik normally
creates. With Traefik not running it has to exist by hand:
`docker network create --attachable coolify`.

## One-time set-up in Coolify

1. **Resource:** Private Git Repository (with Deploy Key) →
   `git@github.com:sambhav874/cs-ai.git`, branch `dev`, build pack
   **Docker Compose**, base directory `/`, compose file
   `/docker-compose.dev.yml`. Add the deploy key Coolify shows to GitHub →
   repo → Settings → Deploy keys (read-only).
2. **Environment variables:**
   - `APP_HOST` — the public hostname, no scheme (`DEMO_HOST` is still read as a fallback).
   - `JWT_SECRET`, `PORTAL_JWT_SECRET`, `INTERNAL_SERVICE_SECRET` —
     `openssl rand -hex 32` each. **`JWT_SECRET` also reaches the
     intelligence tier**, which is what lets a platform token resolve to a
     shadow user there.
   - `AI_KEY_ENCRYPTION_KEY` — set once and never change it, or every stored
     BYO LLM key becomes undecryptable.
   - `S3_ACCESS_KEY`, `S3_SECRET_KEY` — MinIO's credentials.
   - Optional: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (AI features return 503
     without one), `SMTP_*` (nothing is emailed without it).
3. **Deploy on push:** the resource's **Webhooks** page shows a GitHub webhook
   URL and secret. Add them in GitHub → repo → Settings → Webhooks (content
   type `application/json`, push events only).

## Everyday use

- **Deploying:** push to `dev`, or press **Deploy** in Coolify.
- **Logs:** Coolify → the resource → **Logs** (per service) and
  **Deployment Logs** (the build).
- **Rolling back:** Coolify → **Rollback**, or revert on `dev` and push.
- **Seeding sample data:** Coolify → **Terminal** → `api` container:
  `SEED_ALLOW_PRODUCTION=1 SEED_ADMIN_PASSWORD=... pnpm db:seed`.

## Known limits

This is a dev environment, not production. MongoDB, Redis and MinIO live in named volumes on one box
with no backups, a deploy restarts the services (a few seconds of downtime),
and a build briefly loads the VM's two cores. A real deployment is
`deploy/helm` / `deploy/terraform`.

`vendor/draft-legal/docker-compose.selfhost.yml` is draftLegal's own
self-hosted stack, kept for reference. It cannot run this platform: it is
Postgres + Elasticsearch plus the old agents service, all of which the merge
replaced.
