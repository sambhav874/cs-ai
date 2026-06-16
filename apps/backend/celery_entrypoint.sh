#!/bin/bash
set -e

# If arguments are passed, run them instead of the default worker
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "Starting Celery worker..."

exec celery -A celery_app worker \
    --loglevel="${CELERY_LOG_LEVEL:-info}" \
    --concurrency="${CELERY_CONCURRENCY:-4}" \
    --queues="${CELERY_QUEUES:-default,indexing,kpi_ingestion}" \
    --hostname="worker@%h" \
    --beat
