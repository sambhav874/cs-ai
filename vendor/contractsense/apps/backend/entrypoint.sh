#!/bin/bash
set -e

# If arguments are passed, run them instead of the default server
# This allows: docker run ... python -c "import foo; print('OK')"
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Determine the environment (dev, staging, prod)
ENVIRONMENT=${ENVIRONMENT:-dev}

if [ "$ENVIRONMENT" = "prod" ] || [ "$ENVIRONMENT" = "staging" ]; then
    echo "Starting production server with Gunicorn..."
    exec gunicorn -k uvicorn.workers.UvicornWorker \
    --bind "${API_HOST:-0.0.0.0}:${API_PORT:-8000}" \
    --workers "${API_WORKERS:-4}" \
    --timeout "${API_TIMEOUT:-300}" \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile - \
    main:app
else
    echo "Starting development server with Uvicorn..."
    exec uvicorn main:app \
        --host "${API_HOST:-0.0.0.0}" \
        --port "${API_PORT:-8000}" \
        --workers "${API_WORKERS:-2}" \
        --log-level "${LOG_LEVEL:-info}"
fi
