#!/bin/bash
set -e

echo "Starting Celery worker..."

exec poetry run celery -A celery_app worker \
    --loglevel="${CELERY_LOG_LEVEL:-info}" \
    --concurrency="${CELERY_CONCURRENCY:-4}" \
    --queues="${CELERY_QUEUES:-default,indexing,kpi_ingestion}" \
    --hostname="worker@%h" \
    --beat
