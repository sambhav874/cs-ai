# Self-host footprint — 2026-09-22

Measured on the dev VM (2 vCPU, 7.75 GiB RAM) with `docker stats --no-stream`,
the stack idle after 14 hours up. Both platforms run on the same box, so the
comparison is like for like.

**The merged stack idles at 1.04 GiB, about half of draftLegal's 1.95 GiB.**
The plan's 2.4 GB figure for draftLegal was measured elsewhere; on this box it
reads 1.95 GiB. Elasticsearch alone (939 MiB) is most of the gap.

| Container | Idle RAM (MiB) |
| --- | ---: |
| intelligence (FastAPI) | 443.3 |
| worker (Celery) | 196.4 |
| mongo (single-node replica set) | 134.8 |
| api (Fastify) | 127.4 |
| jobs (BullMQ) | 87.4 |
| minio | 59.5 |
| redis | 6.6 |
| gotenberg | 6.2 |
| web (nginx + SPA) | 3.1 |
| **Total, 9 containers** | **1,064.7** |

draftLegal on the same VM: elasticsearch 939.0, gotenberg 226.0, worker 209.2,
agents 189.6, api 176.5, minio 145.8, postgres 90.1, redis 11.5, web 4.9 —
**1,992.6 MiB** over 9 containers.

## Caveats

- Idle only. Peak during a parse or review is not measured yet.
- Qdrant, which the self-host spec lists, is not in the stack. Adding it
  would raise the total.
- The one-command install from a clean machine is **not** proven by this:
  the VM is built by Coolify from `docker-compose.dev.yml`, and
  `deploy/compose/` holds no self-host file yet.

## Reproduce

```bash
ssh root@<vm> 'docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}"'
```
