#!/bin/bash
set -e

# Determine the environment (dev, staging, prod)
ENVIRONMENT=${ENVIRONMENT:-dev}

if [ "$ENVIRONMENT" = "prod" ] || [ "$ENVIRONMENT" = "staging" ]; then
    # Production/Staging - Use Gunicorn with Uvicorn workers
    echo "Starting production server with Gunicorn..."
    exec poetry run gunicorn -k uvicorn.workers.UvicornWorker \
    --bind "${API_HOST:-0.0.0.0}:${API_PORT:-8000}" \
    --workers "${API_WORKERS:-4}" \
    --timeout "${API_TIMEOUT:-300}" \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile - \
    main:app
else
    # Development - Use Uvicorn directly
    echo "Starting development server with Uvicorn..."
    exec poetry run uvicorn main:app \
        --host "${API_HOST:-0.0.0.0}" \
        --port "${API_PORT:-8000}" \
        --workers "${API_WORKERS:-2}" \
        --log-level "${LOG_LEVEL:-info}"
fi