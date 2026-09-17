# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

# Build tools are needed for a few wheels (pymupdf, pydantic-core on some arches).
# tesseract-ocr is the Linux OCR backend for scanned PDFs (Wave 4) — pytesseract
# shells out to it; without the binary, scanned PDFs would extract to empty text.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ca-certificates \
        libmagic1 \
        tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first so the layer caches across code edits.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source.
COPY main.py ./
COPY app/ ./app/

RUN groupadd --system --gid 1001 python && \
    useradd --system --uid 1001 --gid python python && \
    chown -R python:python /app
USER python

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
