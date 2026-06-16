# Backend Developer Guide

## Project Structure

The backend is organized into domain-specific directories. Everything lives under `apps/backend/`.

```
apps/backend/
├── main.py              # FastAPI app entry point — routers are registered here
├── celery_app.py        # Celery configuration and broker setup
├── edit_validator.py    # Standalone contract edit validation logic
│
├── api/
│   ├── dependencies.py  # Shared FastAPI dependency functions (e.g. DB access)
│   └── routes/          # One file per feature area
│       ├── audit.py
│       ├── batch.py
│       ├── beta.py
│       ├── categories.py
│       ├── credits.py
│       ├── edits.py
│       ├── endpoints.py  # Core contract routes (upload, index, process, jobs)
│       ├── questions.py
│       ├── support.py
│       ├── tasks.py
│       ├── teams.py
│       └── websocket.py
│
├── core/                # App-wide infrastructure (config, DB, auth)
│   ├── config.py        # All settings via pydantic-settings (was settings.py)
│   ├── database.py      # MongoDB connections and collection exports
│   ├── database_indexes.py
│   └── security.py      # JWT auth, password hashing (was auth.py)
│
├── models/              # Pydantic data models
│   ├── domain.py        # User, Team, Token models (was models.py)
│   ├── contract_types.py
│   ├── questions.py
│   └── response_types.py
│
├── services/            # Business logic
│   ├── contract_processor.py  # RAG system, MongoDB/Pinecone vector stores, embeddings (was best.py)
│   ├── summarizer.py          # Contract summarization
│   ├── report_generator.py    # IFRS report generation
│   ├── question_suggester.py
│   ├── pro_upgrade_service.py
│   └── ws_manager.py          # WebSocket connection manager
│
├── utils/               # Helpers and cross-cutting utilities
│   ├── helpers.py       # JobManager and shared helpers (was utils.py)
│   ├── audit_logger.py
│   ├── marker_processor.py
│   ├── prompts.py
│   └── jsontocsv.py
│
├── test_support/        # Testing-only app routes/helpers
│   └── testing_utils.py
│
├── worker/
│   └── tasks.py         # All Celery tasks (indexing, summarizing, emails)
│
└── scripts/             # One-off utility scripts, NOT imported by the app
    ├── check.py
    └── debug_query.py
```

---

## File Migration Reference

All files were renamed and moved. Use this table if you're looking for something by its old name.

| Old filename (flat root) | New path |
|---|---|
| `service.py` | `main.py` |
| `settings.py` | `core/config.py` |
| `database.py` | `core/database.py` |
| `database_indexes.py` | `core/database_indexes.py` |
| `auth.py` | `core/security.py` |
| `best.py` | `services/contract_processor.py` |
| `summarize.py` | `services/summarizer.py` |
| `report_generator.py` | `services/report_generator.py` |
| `question_suggester.py` | `services/question_suggester.py` |
| `pro_upgrade_service.py` | `services/pro_upgrade_service.py` |
| `ws_manager.py` | `services/ws_manager.py` |
| `tasks.py` | `worker/tasks.py` |
| `models.py` | `models/domain.py` |
| `contract_types.py` | `models/contract_types.py` |
| `response_types.py` | `models/response_types.py` |
| `questions.py` | `models/questions.py` |
| `utils.py` | `utils/helpers.py` |
| `audit_logger.py` | `utils/audit_logger.py` |
| `marker_processor.py` | `utils/marker_processor.py` |
| `prompts.py` | `utils/prompts.py` |
| `testing_utils.py` | `test_support/testing_utils.py` |
| `jsontocsv.py` | `utils/jsontocsv.py` |
| `endpoints.py` | `api/routes/endpoints.py` |
| `team_routes.py` | `api/routes/teams.py` |
| `categories_route.py` | `api/routes/categories.py` |
| `audit_routes.py` | `api/routes/audit.py` |
| `credits_routes.py` | `api/routes/credits.py` |
| `beta_route.py` | `api/routes/beta.py` |
| `support_routes.py` | `api/routes/support.py` |
| `question_endpoints.py` | `api/routes/questions.py` |
| `task_routes.py` | `api/routes/tasks.py` |
| `edit_endpoints.py` | `api/routes/edits.py` |
| `batch_router.py` | `api/routes/batch.py` |
| `websockets_service.py` | `api/routes/websocket.py` |
| `dependencies.py` | `api/dependencies.py` |
| `check.py` | `scripts/check.py` |
| `debug_query.py` | `scripts/debug_query.py` |

---

## Import Convention

Always use the full module path from the `apps/backend/` root:

```python
# ✅ Correct
from core.config import Settings, settings
from core.database import db, collection, users_collection
from core.security import get_current_active_user
from models.domain import UserInDB
from models.response_types import UploadResponse
from services.contract_processor import ContractRAGSystem
from services.summarizer import ContractSummarizer
from utils.helpers import JobManager
from utils.prompts import SOME_PROMPT
from worker.tasks import process_contract_chain
from api.routes.endpoints import contract_sub_router

# ❌ Never use old flat names
from settings import Settings   # old — file is now core/config.py
from best import ContractRAGSystem  # old — file is now services/contract_processor.py
from auth import get_current_active_user  # old — file is now core/security.py
```

---

## Adding a New API Route

1. Create `api/routes/my_feature.py`
2. Define an `APIRouter` inside it:
   ```python
   from fastapi import APIRouter
   my_router = APIRouter()

   @my_router.get("/my-endpoint")
   async def my_endpoint():
       return {"hello": "world"}
   ```
3. Register it in `main.py`:
   ```python
   from api.routes.my_feature import my_router
   v1_router.include_router(my_router, tags=["My Feature"])
   ```

---

## Adding a New Celery Task

All tasks live in `worker/tasks.py`. Add your task there using the `@celery_app.task` decorator:

```python
@celery_app.task(bind=True, name='my_new_task')
def my_new_task(self, some_arg: str):
    ...
```

Celery discovers tasks via `include=['worker.tasks']` in `celery_app.py` — no registration needed.

---

## Running Locally

```bash
# From the repo root — starts Next.js frontend
npm run dev:frontend

# From the repo root — starts FastAPI backend
npm run dev:backend

# Backend only
cd apps/backend
poetry run uvicorn main:app --reload

# Celery worker (separate terminal)
cd apps/backend
poetry run celery -A celery_app worker --loglevel=info --pool=threads
```

API docs are at: **http://localhost:8000/api/docs**

---

## Environment Variables

Copy `.env.template` → `.env` and fill in the required values. Key variables:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `USE_MONGODB_VECTOR` / `PINECONE_API_KEY` | Vector DB backend selection |
| `CELERY_BROKER_URL` | RabbitMQ URL (e.g. `amqp://guest:guest@localhost:5672//`) |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` | LLM providers |
| `SECRET_KEY` | JWT signing key |
| `AZURE_COMMUNICATION_CONNECTION_STRING` | Email sending |
