# deploy

Two installs from one set of container images.

| Path | Target |
| --- | --- |
| `compose/` | Self-host. `./install.sh` on a clean machine; upgrade, backup and restore scripts. See [compose/README.md](compose/README.md) |
| `helm/` | SaaS. Kubernetes chart, from ContractSense's existing chart |
| `terraform/` | SaaS. Surrounding infrastructure; cloud vendor is still open |

Self-host is a launch requirement, not a later port, so it constrains the
container list from the start: Caddy (TLS), nginx, mongod (single-node replica
set), Redis, MinIO, the Fastify API and its BullMQ worker, the FastAPI service
and its Celery worker, and Gotenberg for HTML→PDF. No Postgres, no
Elasticsearch, no RabbitMQ, and no separate vector database (see
compose/README.md).

Sources: `vendor/contractsense/extractor-chart` and `terraform/`,
`vendor/draft-legal/deploy` and `docker-compose.selfhost.yml` (whose four known
breakages are listed in the Self-host and deploy spec).
