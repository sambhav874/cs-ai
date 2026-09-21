# The demo deployment

Push to `dev` → the demo updates itself, usually in two to three minutes.

```
git push  ──▶  GitHub Actions  ──▶  GHCR (api / web / intelligence)
                                          │
                                          └──▶ Coolify webhook ──▶ VM pulls, restarts
```

GitHub builds the images, not the VM. A three-service build on the demo box
takes many minutes and pins its CPU, so the demo would be unusable exactly when
someone has just pushed. The VM only pulls layers and restarts.

Everything is served from **one hostname**. `web` (nginx) serves the SPA and
proxies `/api` to the lifecycle API and `/intel` to the intelligence tier —
which is what the app already assumes, so there is no CORS and no second
subdomain to certify.

## What runs

| Service | Image | Notes |
| --- | --- | --- |
| `web` | `web` | nginx: the SPA plus the two proxies. The only service Coolify exposes. |
| `api` | `api` | Fastify lifecycle API. `WORKERS_ENABLED=false` — it must not drain the queue. |
| `jobs` | `api` | BullMQ workers, renewal and obligation scans. |
| `intelligence` | `intelligence` | FastAPI. |
| `worker` | `intelligence` | Celery. Same image, different entrypoint. |
| `migrate` | `api` | One-shot `prisma db push` before the API starts. |
| `minio-init` | `minio/mc` | Creates the bucket; MinIO will not create one on first PUT. |
| `mongo` | `mongo:7` | Single-node **replica set** — Prisma needs one for transactions, the Space watcher for change streams. Self-initiating on first boot. |
| `redis`, `minio`, `gotenberg` | — | Queue, object store, HTML→PDF. |

Three images, five app services: the API and the jobs runner share one, and so
do the two intelligence processes. Fewer builds, faster deploys.

## One-time set-up

### 1. Coolify

1. **Projects → New → Docker Compose**, source = this repo, branch `dev`,
   compose path `deploy/coolify/docker-compose.yml`.
2. **Turn Coolify's own auto-deploy off.** CI triggers the deploy after the
   images exist; if Coolify also redeploys on push it will restart with the
   *previous* images and look like a deploy that did nothing.
3. On the `web` service, set the domain to your subdomain (say
   `demo.yourdomain.com`). Coolify issues the Let's Encrypt certificate and
   renews it. Point that subdomain's A record at the VM first.
4. If the GHCR packages are private, add a registry credential in Coolify
   (**Keys & Tokens → Docker registries**) with a GitHub PAT that has
   `read:packages`. Making the packages public instead is simpler and is fine
   for images that contain no secrets.

### 2. Environment, in Coolify's editor

Generate each secret **once** and keep it — rotating `AI_KEY_ENCRYPTION_KEY`
makes every stored BYO LLM key undecryptable.

```bash
openssl rand -hex 32   # JWT_SECRET — and again for each of the next two
```

Required:

- `DEMO_HOST` — the bare hostname, e.g. `demo.yourdomain.com` (no scheme).
- `JWT_SECRET` — **the same value reaches the intelligence tier**, which is
  what lets a platform token resolve to a shadow user there.
- `PORTAL_JWT_SECRET`, `INTERNAL_SERVICE_SECRET`.

Worth setting: `AI_KEY_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
(AI features return 503 without one), `SMTP_*` (nothing is emailed without it,
so signer invitations silently never arrive), and `S3_ACCESS_KEY` /
`S3_SECRET_KEY` if you would rather not run MinIO on its defaults.

### 3. GitHub repository secrets

| Secret | Value |
| --- | --- |
| `COOLIFY_URL` | `https://coolify.yourdomain.com` |
| `COOLIFY_TOKEN` | Coolify → **Keys & Tokens → API tokens**, with deploy permission |
| `COOLIFY_DEMO_UUID` | the resource UUID, visible in the Coolify URL for this stack |
| `DEMO_URL` | `https://demo.yourdomain.com` — polled for readiness after deploying |

GHCR needs no secret; the workflow's `GITHUB_TOKEN` can push to it.

## Everyday use

- **Deploying:** push to `dev`. Watch it in the repo's Actions tab. The job
  only goes green once `/api/health/ready` answers 200, so a green tick means
  the demo really came back up.
- **Redeploying unchanged code, or rolling back:** run **Deploy demo** from the
  Actions tab. Every build is also tagged with its commit SHA, so an older
  image can be pinned by setting `TAG` in Coolify to that SHA and redeploying.
- **Seeding demo data:** from the `api` container,
  `SEED_ALLOW_PRODUCTION=1 SEED_ADMIN_PASSWORD=... pnpm db:seed`.
- **Backfilling Spaces** for pre-existing projects:
  `npx tsx scripts/backfill-spaces.ts` (dry run), then `--write`.

## Known limits

This is a demo stack, not a production one. It keeps MongoDB, Redis and MinIO
as containers on one box with named volumes: fine to lose, and nothing backs
them up. It also deploys by restarting, so there are a few seconds of downtime
per deploy. Both are deliberate — a real deployment is
`deploy/helm` / `deploy/terraform`.

`vendor/draft-legal/docker-compose.selfhost.yml` is draftLegal's own
self-hosted stack, kept for reference. It cannot run this platform: it is
Postgres + Elasticsearch plus the old agents service, all of which the merge
replaced.
