# Self-host

ContractSense on one machine with Docker. One command installs it; three
more keep it running.

| Script | What it does |
| --- | --- |
| `./install.sh` | Generates secrets and a signing certificate, builds the images, starts everything, waits until it is healthy. |
| `./upgrade.sh` | Backs up, updates, restarts, checks health, and starts the previous version again if the new one does not come up. |
| `./backup.sh` | Databases, documents and configuration into `backups/<timestamp>/`, keeping the newest seven. |
| `./restore.sh` | Puts a backup back. Replaces the current data. |

## Requirements

- Linux, 2+ vCPU, **4 GiB RAM** or more, 20 GiB disk plus room for documents.
  The stack idles at about 1.1 GiB ([measured](../../docs/self-host-footprint.md));
  parsing a large contract needs the rest.
- Docker Engine 24+ with the Compose plugin, `git`, `openssl`.
- For HTTPS: a hostname whose DNS points at the machine, and ports 80 and 443
  open to the internet (Let's Encrypt checks them).

## Install

```bash
git clone <this repository> contractsense
cd contractsense/deploy/compose
./install.sh --domain contracts.example.com
```

Without a public hostname (a trial, or behind your own TLS proxy):

```bash
./install.sh --http-only --http-port 8080
```

The first build takes 10–20 minutes. When it finishes, open the address it
prints and choose **Set up this instance**: that first account is the admin.
After it exists, sign-up is closed and people join by invite
(`REGISTRATION_MODE=first-user`; `open` allows anyone to create an
organisation, `closed` allows no sign-up at all).

**AI is off until a model key is added.** Contracts upload, parse, and go
through review, approval and signature without one; extraction, the AI
playbook review and the assistant need a key. Add it in **Admin → AI**
(per organisation, stored encrypted), or set `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` in `.env` and run `docker compose up -d`.

**Email** needs `SMTP_*` in `.env`. Without it nothing is sent: invites,
signing requests and reminders.

## What runs

Eleven long-running containers and three one-shot setup containers; only `edge` is published:

| Service | Role |
| --- | --- |
| `edge` | Caddy. TLS (automatic Let's Encrypt certificate) and the only published ports. |
| `web` | nginx: the app, and the proxy to `api` and `intelligence`. |
| `api`, `jobs` | Lifecycle API, and its queue workers and daily scans. |
| `intelligence`, `worker` | Extraction, review and the assistant, and their background worker. |
| `mongo` | MongoDB 8.3, single-node replica set. |
| `mongot` | MongoDB's search process: the vector index contract Q&A retrieves from. |
| `redis` | Queues. Append-only, so a restart loses no jobs. |
| `minio` | Document storage. |
| `gotenberg` | HTML → PDF, blocked from reaching anything on the network. |
| `migrate`, `minio-init` | Run once per start: schema update, storage bucket. |
| `mongo-migrate` | Runs once, ever: copies an older install's MongoDB 7 data into 8.3. |

MongoDB, Redis and MinIO are reachable only inside the Compose network, so
they run without passwords of their own (MinIO has generated credentials).
Do not publish their ports.

**Vector search is MongoDB's own.** `mongot` indexes what `mongo` holds, so
there is no separate vector database. Embeddings need a Voyage key in
`VOYAGE_API_KEY`: one from dash.voyageai.com, or a model API key from MongoDB
Atlas (routed to MongoDB's endpoint automatically). Without a key, contracts
are indexed without embeddings and the assistant ranks passages by keyword;
upload, extraction and review do not depend on it.

**Or use MongoDB Atlas.** Set `DATABASE_URL` (the `csai` database) and
`MONGODB_URI` (the cluster, no database) in `.env` to your Atlas connection
strings; vector search then runs in Atlas, and the local `mongo` and `mongot`
sit idle.

## Configuration

Everything lives in `.env` next to `docker-compose.yml`, written by
`install.sh` with mode 600. After changing it, run `docker compose up -d`.

Two values must never change once data exists:

- `AI_KEY_ENCRYPTION_KEY` encrypts stored model keys.
- `SIGNING_CERT_*` is the certificate executed PDFs are sealed with. The
  installer's certificate is self-signed: seals verify, but PDF readers show
  the signer as untrusted. To show a trusted signer, replace both values with
  a CA-issued certificate (PKCS#12, base64) and its passphrase.

Keep a copy of `.env` somewhere safe. Every backup includes one.

## Upgrade

```bash
./upgrade.sh                # latest commit of this checkout's branch
./upgrade.sh --ref v1.4.0   # a specific tag, branch or commit
```

It backs up first, keeps the running images tagged `:previous`, rebuilds,
starts the new version (the schema update runs before the API does), and
waits for health. If the new version is not healthy within ten minutes it
starts the previous images again. Data is not rolled back automatically: the
schema update only adds fields and indexes, which the previous version
ignores. The backup taken at the start is there if you need `./restore.sh`.

**Upgrading from MongoDB 7.** MongoDB 8.3 cannot open 7.0's data files, so
the first upgrade to a version with `mongot` starts 8.3 on a new volume
(`mongo8-data`) and `mongo-migrate` copies every database across from the old
one (`mongo-data`) before anything else starts. The old volume is left as it
was. Once you are satisfied, remove it with
`docker volume rm contractsense_mongo-data`. The upgrade also adds
`MONGOT_PASSWORD` to `.env`.

## Backups

```bash
./backup.sh                   # into ./backups
./backup.sh /mnt/backups/cs   # somewhere else
```

Runs while the stack is up. Schedule it, and copy the result off the machine:

```cron
0 2 * * *  /opt/contractsense/deploy/compose/backup.sh /mnt/backups/cs >> /var/log/cs-backup.log 2>&1
```

A backup is `mongo.archive.gz` (both databases, consistent to one moment),
`files/` (every document), `env` (configuration and secrets) and a
`MANIFEST`. Treat it as secret: it contains the secrets and every contract.

## Restore

```bash
./restore.sh backups/20260923T020000Z
```

It asks you to type `restore`, stops the application, replaces the databases
and documents, and starts again. On a new machine, clone the repository,
check out the backup's commit (in its `MANIFEST`), and run
`./restore.sh <backup> --with-env` to bring the secrets back too; no
`install.sh` is needed.

## Everyday commands

Run in this directory:

```bash
docker compose ps                  # what is running, and health
docker compose logs -f api         # follow one service
docker compose restart intelligence
docker compose down                # stop; data stays in the volumes
```

`docker compose down -v` deletes the volumes, and with them every contract.
