# syntax=docker/dockerfile:1.7
#
# One image for the intelligence tier. The API and the Celery worker run the
# same code and the same dependencies, so they share an image and differ only
# in entrypoint (see deploy/coolify/docker-compose.yml). One build, two
# services — which halves deploy time.
#
# Replaces Containerfile / Containerfile.worker, which still pointed at
# ContractSense's old apps/backend layout.
#
# Build context is the REPO ROOT.

FROM python:3.11-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl -sSL https://install.python-poetry.org | python3 -
ENV PATH="/root/.local/bin:$PATH"
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    VIRTUAL_ENV="/opt/venv" \
    POETRY_VIRTUALENVS_CREATE=false

# Dependencies first: this layer only rebuilds when the lock changes.
COPY apps/intelligence/pyproject.toml apps/intelligence/poetry.lock ./
ARG POETRY_EXTRAS=""
RUN set -ex && \
    if [ -z "$POETRY_EXTRAS" ]; then \
      poetry install --no-root --no-interaction; \
    else \
      poetry install --no-root --no-interaction --extras "$POETRY_EXTRAS"; \
    fi

# Trim the venv: build-only tooling and test trees are dead weight at runtime.
RUN find /opt/venv -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true; \
    find /opt/venv -type d \( -name tests -o -name test -o -name examples \) -prune -exec rm -rf {} + 2>/dev/null || true; \
    rm -rf /opt/venv/lib/python3.11/site-packages/poetry /root/.cache

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=prod \
    API_PORT=8000 \
    PATH="/opt/venv/bin:$PATH"
# tesseract-ocr: scanned-PDF OCR for the agent routes' /extract (pytesseract
# drives this binary). draftLegal's agents image had it; without it a scanned
# upload extracts no text.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl tesseract-ocr \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY apps/intelligence/ ./

RUN chmod +x entrypoint.sh celery_entrypoint.sh \
    && useradd --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD curl -fsS http://127.0.0.1:${API_PORT}/health >/dev/null || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
