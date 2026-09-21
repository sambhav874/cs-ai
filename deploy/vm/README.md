# The demo deployment

Push to `dev` → GitHub Actions copies the commit to the demo VM over SSH and
rebuilds the stack there. No registry, no Coolify: the images are built on the
VM and never leave it.

```
git push dev ──▶ Actions ──ssh──▶ VM: /opt/contractsense/src
                                      docker compose up -d --build
                                      Caddy :443 ──▶ 127.0.0.1:8090 (web)
```

A code-only change redeploys in a couple of minutes, because Docker's layer
cache on the VM keeps the dependency installs. Changing a lockfile rebuilds
that image's install layer, which takes longer (the Python one is the slowest).

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

Three builds cover five app services. The compose project is `contractsense`,
so nothing collides with the old draftLegal stack on the same VM.

## One-time set-up

### 1. The VM

The VM's host Caddy already owns ports 80/443 and serves the old draftLegal
demo. Add a site for this one beside it in `/etc/caddy/Caddyfile`:

```
cs.187-7-17-249.sslip.io {
	encode gzip
	reverse_proxy 127.0.0.1:8090
}
```

Then `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`.

Create `/opt/contractsense/.env`, readable by root only, with:

- `DEMO_HOST` — the public hostname, no scheme.
- `JWT_SECRET`, `PORTAL_JWT_SECRET`, `INTERNAL_SERVICE_SECRET` —
  `openssl rand -hex 32` each. **`JWT_SECRET` also reaches the intelligence
  tier**, which is what lets a platform token resolve to a shadow user there.
- `AI_KEY_ENCRYPTION_KEY` — set once and never change it, or every stored BYO
  LLM key becomes undecryptable.
- `S3_ACCESS_KEY`, `S3_SECRET_KEY` — MinIO's credentials.
- Optional: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (AI features return 503
  without one), `SMTP_*` (nothing is emailed without it).

Authorise the deploy key: append its public half to `/root/.ssh/authorized_keys`.

### 2. GitHub repository secrets

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | the VM's IP |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | the deploy key's **private** half |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan <ip>` output — pins the VM's host key |
| `DEMO_URL` | `https://cs.187-7-17-249.sslip.io` — polled after each deploy |

## Everyday use

- **Deploying:** push to `dev`. The job only goes green once
  `/api/health/ready` answers 200 through Caddy, so a green tick means the
  public URL works. On failure it prints the last API, intelligence and migrate
  logs.
- **Redeploying without a push:** run **Deploy demo** from the Actions tab.
- **Rolling back:** the previous source tree is kept at
  `/opt/contractsense/src.old`; rebuild from it, or revert on `dev` and push.
- **Logs:** `cd /opt/contractsense/src && docker compose -p contractsense -f deploy/vm/docker-compose.yml --env-file ../.env logs -f api`
- **Seeding demo data:** in the `api` container,
  `SEED_ALLOW_PRODUCTION=1 SEED_ADMIN_PASSWORD=... pnpm db:seed`.

## Known limits

This is a demo stack. MongoDB, Redis and MinIO live in named volumes on one
box with no backups, and a deploy restarts the services, so there are a few
seconds of downtime. The build also briefly loads the VM's two cores. A real
deployment is `deploy/helm` / `deploy/terraform`.

`vendor/draft-legal/docker-compose.selfhost.yml` is draftLegal's own
self-hosted stack, kept for reference. It cannot run this platform: it is
Postgres + Elasticsearch plus the old agents service, all of which the merge
replaced.
