#!/bin/bash
set -e

# If arguments are passed, run them instead of the default worker
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# CELERY_MODE selects which process to run: "worker" (default) or "beat"
CELERY_MODE="${CELERY_MODE:-worker}"

if [ "$CELERY_MODE" = "beat" ]; then
    echo "Starting Celery beat scheduler..."
    exec celery -A celery_app beat \
        --loglevel="${CELERY_LOG_LEVEL:-info}" \
        --pidfile=
else
    echo "Starting Celery worker (pool=${CELERY_POOL:-gevent}, concurrency=${CELERY_CONCURRENCY:-60})..."
    exec celery -A celery_app worker \
        --loglevel="${CELERY_LOG_LEVEL:-info}" \
        --concurrency="${CELERY_CONCURRENCY:-60}" \
        --pool="${CELERY_POOL:-gevent}" \
        --queues="${CELERY_QUEUES:-default,indexing,kpi_ingestion}" \
        --hostname="worker@%h"
fi
