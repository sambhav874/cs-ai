# deploy

Two installs from one set of container images.

| Path | Target |
| --- | --- |
| `compose/` | Self-host. One command from a clean machine, nine containers |
| `helm/` | SaaS. Kubernetes chart, from ContractSense's existing chart |
| `terraform/` | SaaS. Surrounding infrastructure; cloud vendor is still open |

Self-host is a launch requirement, not a later port, so it constrains the
container list from the start: nginx, mongod (single-node replica set), Redis,
Qdrant, MinIO, the Fastify API and its BullMQ worker, the FastAPI service and
its Celery worker, and Gotenberg where DOCX→PDF is needed. No Postgres, no
Elasticsearch, no RabbitMQ.

Sources: `vendor/contractsense/extractor-chart` and `terraform/`,
`vendor/draft-legal/deploy` and `docker-compose.selfhost.yml` (whose four known
breakages are listed in the Self-host and deploy spec).
