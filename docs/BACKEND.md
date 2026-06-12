# Backend Documentation

The backend is a **FastAPI** application served by **Uvicorn** (dev) / **Gunicorn + Uvicorn workers** (prod). It exposes a REST API and a WebSocket endpoint and delegates long-running work to a **Celery** task queue backed by **RabbitMQ**.

---

## Table of Contents

- [Directory Layout](#directory-layout)
- [Layer Responsibilities](#layer-responsibilities)
- [Configuration (`core/config.py`)](#configuration)
- [Application Entrypoint (`main.py`)](#application-entrypoint)
- [Authentication & Security](#authentication--security)
- [API Routes](#api-routes)
- [Services](#services)
- [Models](#models)
- [Utilities](#utilities)
- [Database](#database)
- [Running Locally](#running-locally)
- [Testing](#testing)

---

## Directory Layout

```
apps/backend/
├── main.py                  # FastAPI app creation, middleware, router wiring
├── celery_app.py            # Celery app factory + configuration
├── celery_entrypoint.sh     # Shell script to start the Celery worker
├── entrypoint.sh            # Shell script to start the FastAPI server
├── pyproject.toml           # Python dependencies (Poetry)
├── Containerfile            # Container image for the API server
├── Containerfile.worker     # Container image for the Celery worker
│
├── api/
│   ├── dependencies.py      # Shared FastAPI dependency injection functions
│   └── routes/
│       ├── endpoints.py     # Core contract CRUD, upload, and analysis routes (main)
│       ├── audit.py         # Audit log routes
│       ├── batch.py         # Batch-processing routes
│       ├── beta.py          # Beta applicant registration routes
│       ├── categories.py    # Question category management routes
│       ├── credits.py       # Credit system routes
│       ├── edits.py         # Contract edit utilities routes
│       ├── questions.py     # AI question suggestion routes
│       ├── support.py       # Support ticket routes
│       ├── tasks.py         # Celery task status polling routes
│       ├── teams.py         # Multi-tenancy: team & account management routes
│       ├── vouchers.py      # Voucher/discount code routes
│       └── websocket.py     # WebSocket endpoint for real-time job status
│
├── core/
│   ├── config.py            # Pydantic Settings — typed ENV var model
│   ├── database.py          # MongoDB Motor client + GridFS initialisation
│   ├── database_indexes.py  # MongoDB index creation helpers
│   └── security.py          # JWT creation/validation, password hashing
│
├── models/
│   ├── domain.py            # Core MongoDB document shapes (Contract, User, Team…)
│   ├── contract_types.py    # Contract type enums and helpers
│   ├── questions.py         # Question / Category pydantic models
│   └── response_types.py    # API response shapes (QuestionAnswer, ContractAnalysis…)
│
├── services/
│   ├── contract_processor.py  # ContractRAGSystem — LangChain RAG pipeline
│   ├── summarizer.py          # ContractSummarizer — LLM summarization
│   ├── report_generator.py    # ReportGenerator — IFRS 15 report builder
│   ├── question_suggester.py  # AI-powered question suggestion service
│   ├── pro_upgrade_service.py # Stripe subscription upgrade service
│   └── ws_manager.py          # WebSocket connection manager
│
├── utils/
│   ├── helpers.py           # JobManager — job CRUD in MongoDB
│   ├── prompts.py           # LLM prompt templates (all prompts centralised here)
│   ├── audit_logger.py      # Structured audit event logger
│   ├── marker_processor.py  # Local Marker PDF processor wrapper
│   └── jsontocsv.py         # JSON → CSV conversion helper
│
├── test_support/
│   └── testing_utils.py     # Test-only routes and helpers (TESTING=true only)
│
├── worker/
│   └── tasks.py             # All Celery task definitions
│
├── scripts/                 # One-off / maintenance scripts (not imported by app)
└── templates/               # Jinja2 HTML email templates
```

---

## Layer Responsibilities

| Layer | Responsibility | Should NOT |
|---|---|---|
| `api/routes` | Parse HTTP requests, validate input, call services, return responses | Contain business logic or DB queries |
| `services` | Orchestrate business logic, call LLMs, call external APIs | Know about HTTP context or Celery internals |
| `models` | Define data structures (Pydantic) | Contain logic |
| `core` | App-wide infrastructure (config, DB, security) | Be imported by `models` or `utils` |
| `utils` | Stateless helper functions and shared tooling | Contain service-level logic |
| `worker/tasks.py` | Celery task entry points; validate input, delegate to services | Duplicate service logic |

---

## Configuration

All configuration is centralised in `core/config.py` via a **Pydantic `BaseSettings`** class. Variables are loaded from `apps/backend/.env` (or `testing/backend/.env.test` when `TESTING=true`).

### Key Variable Groups

| Group | Variables |
|---|---|
| LLM Providers | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY` |
| Vector DB | `MONGODB_URI`, `USE_MONGODB_VECTOR`, `PINECONE_API_KEY` |
| Embeddings | `MONGODB_VOYAGE_API_KEY`, `VOYAGEAI_API_KEY`, `OPENAI_EMBEDDING_MODEL` |
| PDF Processing | `MARKER_API_KEY`, `MARKER_API_URL` |
| Database | `MONGODB_URI` |
| Auth / Security | `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES` |
| Celery | `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` |
| Azure | `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_SENDER_ADDRESS` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| App | `API_HOST`, `API_PORT`, `ALLOWED_ORIGINS`, `DEBUG_MODE` |

Copy `.env.template` to `.env` and fill in the required values before starting.

---

## Application Entrypoint

`main.py` bootstraps the FastAPI app in this order:

1. **Import collections** from `api/routes/endpoints.py` and attach them to `app.state` so routes can access them via dependency injection.
2. **Load settings** via `core/config.py`.
3. **Create `FastAPI` instance** with Swagger at `/api/docs` and ReDoc at `/api/redoc`.
4. **Register a custom CORS middleware** that passes WebSocket upgrade requests through without CORS checks (auth is enforced at the endpoint level).
5. **Mount all routers** under the `/api/v1` prefix.
6. **Startup event** — pings the Celery broker to verify connectivity.

### API Router Tree

```
/api/v1
├── /contracts/*          → contract_sub_router  (endpoints.py)
├── /teams/*              → team_sub_router       (teams.py)
├── /categories/*         → categories_sub_router (categories.py)
├── /audit/*              → audit_logger_sub_router (audit.py)
├── /ws/*                 → status_router         (websocket.py)
├── /credits/*            → credits_sub_router    (credits.py)
├── /vouchers/*           → voucher_sub_router    (vouchers.py)
├── /beta/*               → beta_router           (beta.py)
├── /support/*            → support_sub_router    (support.py)
├── /questions/*          → question_router       (questions.py)
├── /tasks/*              → task_router           (tasks.py)
└── /edits/*              → edit_router           (edits.py)
```

---

## Authentication & Security

Authentication is implemented in `core/security.py` using **JWT tokens (HS256)**.

| Function | Description |
|---|---|
| `create_access_token(data)` | Creates a signed JWT with configurable expiry |
| `verify_token(token)` | Decodes and validates a JWT; raises `401` on failure |
| `get_password_hash(password)` | bcrypt-hashes a plaintext password |
| `verify_password(plain, hashed)` | Verifies a plaintext password against a hash |

**FastAPI dependency** (`api/dependencies.py`): `get_current_user` extracts the token from the `Authorization: Bearer <token>` header and returns the authenticated user document. Use it in route handlers:

```python
from api.dependencies import get_current_user

@router.get("/protected")
async def my_route(current_user = Depends(get_current_user)):
    ...
```

---

## API Routes

### Core Contract Routes (`api/routes/endpoints.py`)

This is the largest route file. Key actions:

| Method | Path | Description |
|---|---|---|
| `POST` | `/contracts/upload` | Upload PDF, store in GridFS, trigger Celery chain |
| `GET` | `/contracts/{id}` | Fetch a contract and its analysis results |
| `GET` | `/contracts` | List contracts for the authenticated user |
| `DELETE` | `/contracts/{id}` | Delete a contract and its associated data |
| `POST` | `/contracts/{id}/reprocess` | Re-trigger processing with new questions |
| `GET` | `/contracts/{id}/report` | Generate/retrieve IFRS 15 report |

### Teams (`teams.py`)

Multi-tenant team management: create teams, invite members, manage roles, transfer ownership.

### Categories (`categories.py`)

CRUD for custom question categories attached to a team or user.

### Credits (`credits.py`)

Credit balance queries, top-up via Stripe, deduction history.

### Audit (`audit.py`)

Query structured audit logs for compliance and analytics.

### WebSocket (`websocket.py`)

```
ws://<host>/api/v1/ws/job-status?token=<JWT>
```

Pushes real-time progress updates for running Celery jobs. See [Workers documentation](WORKERS.md) for the full message schema.

---

## Services

### `ContractRAGSystem` (`services/contract_processor.py`)

The core RAG pipeline:
1. Loads the markdown-converted contract text.
2. Chunks text using LangChain's `RecursiveCharacterTextSplitter`.
3. Embeds chunks via **MongoDB-hosted Voyage AI** (primary), direct Voyage AI (secondary), or OpenAI.
4. Stores embeddings in **MongoDB Atlas Vector Search** (primary), **Pinecone** (secondary fallback), or **FAISS** (local fallback).
5. For each question, retrieves top-k relevant chunks and sends them with the question to the chosen LLM.
6. Returns a `ContractAnalysis` object with structured `QuestionAnswer` results.

**AI provider selection**: pass `ai_provider="anthropic"` | `"gemini"` | `"openai"` | `"groq"` at instantiation time. Defaults to Anthropic Claude.

### `ContractSummarizer` (`services/summarizer.py`)

Takes the raw markdown text and calls the LLM to produce an executive summary in structured markdown format. Provider is also runtime-configurable.

### `ReportGenerator` (`services/report_generator.py`)

Builds an IFRS 15 report from the contract analysis results. Calls the LLM with specialised prompts for each IFRS section.

### `WSManager` (`services/ws_manager.py`)

Maintains an in-memory registry of active WebSocket connections keyed by user ID. Used by the WebSocket route and can be called from anywhere in the app to push messages.

---

## Models

### `models/domain.py`

Core MongoDB document shapes; used as both validation schemas and DB write targets.

### `models/response_types.py`

Pydantic models returned by API endpoints. Key types:

| Type | Description |
|---|---|
| `QuestionAnswer` | A single question + extracted answer + confidence |
| `ContractAnalysis` | A versioned list of `QuestionAnswer` results |

---

## Utilities

| Utility | Description |
|---|---|
| `utils/helpers.py` | `JobManager` — create/update/query job documents in MongoDB |
| `utils/prompts.py` | All LLM system and user prompts kept in a single file |
| `utils/audit_logger.py` | Writes structured audit events to the `audit_logs` collection |
| `utils/marker_processor.py` | Thin wrapper around the local Marker library |

---

## Database

`core/database.py` initialises a **Motor** (async) MongoDB client plus a **GridFS** bucket for storing uploaded PDFs.

Collections used:

| Collection | Purpose |
|---|---|
| `contracts` | Main contract documents |
| `users` | User accounts |
| `teams` | Team/account documents |
| `accounts` | Account-level settings |
| `jobs` | Celery job tracking documents |
| `audit_logs` | Immutable audit trail |
| `categories` | Question category definitions |

Indexes are created at startup via `core/database_indexes.py`.

---

## Running Locally

```bash
# from apps/backend/
poetry install
cp .env.template .env       # then fill in required values

# Start the API server (hot-reload)
poetry run uvicorn main:app --reload --host 0.0.0.0 --port 8000

# In a separate terminal, start the Celery worker
bash celery_entrypoint.sh
```

API docs available at: `http://localhost:8000/api/docs`

---

## Testing

```bash
# Run with test config (testing/backend/.env.test)
TESTING=true poetry run pytest ../../testing/backend/tests

# Or use the test API via the testing_router
# (mounted at /api/v1/testing only when TESTING=true)
```
