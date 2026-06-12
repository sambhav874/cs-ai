# Background Workers Documentation

The background worker system is powered by **Celery 5** with **RabbitMQ** as the default message broker (Azure Service Bus is also supported). Long-running contract processing work is moved off the API request path and executed asynchronously in separate worker processes.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Celery Configuration](#celery-configuration)
- [Queue Architecture](#queue-architecture)
- [Task Definitions](#task-definitions)
- [The Processing Chain](#the-processing-chain)
- [Job Tracking](#job-tracking)
- [Progress Reporting & WebSocket Integration](#progress-reporting--websocket-integration)
- [Error Handling & Retries](#error-handling--retries)
- [Security Hardening](#security-hardening)
- [Adding a New Task](#adding-a-new-task)
- [Running the Worker](#running-the-worker)
- [Monitoring](#monitoring)

---

## How It Works

```
API receives /upload request
      │
      ▼
Store PDF in MongoDB GridFS
      │
      ▼
Trigger process_contract_chain.apply_async(...)
      │
      ▼  (RabbitMQ)
┌─────────────────────────────────────────┐
│           Celery Worker Process         │
│                                         │
│  1. index_contract_task   (0% → 30%)    │
│         │ PDF → Marker API → Markdown   │
│         │ Store in MongoDB              │
│         ▼                               │
│  2. summarize_contract_task (30% → 50%) │
│         │ LLM → Executive Summary       │
│         │ Store in MongoDB              │
│         ▼                               │
│  3. process_contract_task  (50% → 100%) │
│         │ RAG Pipeline → Q&A Results    │
│         │ Store in MongoDB              │
└─────────────────────────────────────────┘
      │
      ▼
JobManager updates MongoDB jobs collection
      │
      ▼
WebSocket pushes progress to connected clients
```

---

## Celery Configuration

The Celery app is configured in `celery_app.py`. Key settings:

| Setting | Value | Reason |
|---|---|---|
| `task_acks_late` | `True` | Task acknowledged only after completion; prevents data loss if worker crashes |
| `worker_prefetch_multiplier` | `1` | One task at a time per worker; prevents memory bloat on large contracts |
| `worker_pool` | `threads` | Thread pool (not processes) — allows sharing in-process state |
| `worker_max_tasks_per_child` | `100` | Recycle workers to avoid memory leaks |
| `task_time_limit` | `7200` (2 hrs) | Hard kill to prevent zombie tasks |
| `task_soft_time_limit` | `5400` (1.5 hrs) | Raises `SoftTimeLimitExceeded` for graceful shutdown |
| `task_reject_on_worker_lost` | `True` | Re-queues task if worker is killed unexpectedly |

### Broker Configuration Priority

The broker URL is resolved in this order:

1. `CELERY_BROKER_URL` environment variable (highest priority)
2. Azure Service Bus (if `USE_AZURE_SERVICE_BUS=true` and `SERVICE_BUS_NAMESPACE` is set)
3. `amqp://guest:guest@localhost:5672//` (local RabbitMQ fallback)

### Result Backend Priority

1. `CELERY_RESULT_BACKEND` environment variable
2. Azure Blob Storage (if `USE_AZURE_BLOB_STORAGE=true`)
3. `rpc://` (result stored in RabbitMQ itself — no extra infra needed)

---

## Queue Architecture

| Queue | Exchange | Tasks Routed |
|---|---|---|
| `default` | `default` | `process_contract_chain`, `send_beta_welcome_email_task` |
| `indexing` | `indexing` | `index_contract_task` |
| `summarizing` | `summarizing` | `summarize_contract_task` |
| `processing` | `processing` | `process_contract_task` |

You can run multiple worker instances each consuming from a specific queue to scale independently:

```bash
# Start an indexing-only worker
celery -A celery_app worker -Q indexing --concurrency=4

# Start a processing-only worker
celery -A celery_app worker -Q processing --concurrency=2
```

---

## Task Definitions

All tasks live in `worker/tasks.py`.

### `index_contract_task`

**Queue**: `indexing`  
**Purpose**: Convert the uploaded PDF to structured markdown.

| Step | Action |
|---|---|
| 1 | Validate inputs (user ID, contract ID, filename) |
| 2 | Retrieve PDF binary from MongoDB GridFS |
| 3 | Write to a secure temp directory (chmod 700) |
| 4 | Submit to Marker API (or local Marker) |
| 5 | Poll Marker API until `status == "complete"` |
| 6 | Store `index.content` (markdown) and `index.html_content` in MongoDB |
| 7 | Mark contract as `"Indexed"` |

**Returns**: `{ "status": "success", "contract_id": "...", "index_content": "..." }`

---

### `summarize_contract_task`

**Queue**: `summarizing`  
**Purpose**: Generate an executive summary from the markdown content.

| Step | Action |
|---|---|
| 1 | Extract `index_content` from the previous task's return value |
| 2 | Instantiate `ContractSummarizer` with the selected AI provider |
| 3 | Call `summarizer.generate_summary(index_content)` |
| 4 | Store `summarize.summary` in MongoDB |
| 5 | Mark contract as `"Summarized"` |

**Returns**: `{ "status": "success", "contract_id": "...", "index_content": "...", "ai_provider": "..." }`

---

### `process_contract_task`

**Queue**: `processing`  
**Purpose**: Run the full RAG pipeline to answer all user questions.

| Step | Action |
|---|---|
| 1 | Write markdown to a secure temp file |
| 2 | Instantiate `ContractRAGSystem` with the selected AI provider |
| 3 | Load and chunk the document |
| 4 | Embed chunks, upsert to MongoDB Atlas (primary), Pinecone, or FAISS |
| 5 | For each question: retrieve top-k chunks + call LLM |
| 6 | Validate results as `QuestionAnswer` objects |
| 7 | Store `process.results` in MongoDB |
| 8 | Mark contract as `"Ready to Edit"` |

**Returns**: `{ "status": "success", "contract_id": "..." }`

---

### `process_contract_chain`

**Queue**: `default`  
**Purpose**: Orchestrator task that builds and dispatches the `index → summarize → process` Celery chain.

This is the task triggered by the API endpoint. It does not do any processing itself — it simply constructs the workflow and calls `apply_async()`.

```python
workflow = chain(
    index_contract_task.s(...),
    summarize_contract_task.s(...),
    process_contract_task.s(...)
)
workflow.apply_async()
```

The `ai_provider` parameter is propagated through the entire chain, allowing users to choose their preferred LLM at upload time.

---

### `send_beta_welcome_email_task`

**Queue**: `default`  
**Purpose**: Send a welcome email to new beta applicants via Azure Communication Services.

- Renders the `templates/welcome_email.html` Jinja2 template with `name` and `coupon_code`
- Sends via Azure ACS Email SDK
- Retries up to 3 times on failure

---

## The Processing Chain

Celery chains pass the **return value of each task as the first positional argument** to the next task. This is how `index_content` flows from indexing → summarizing → processing without a separate DB read.

```
index_contract_task  →  returns { index_content: "..." }
         │
         ▼ (piped as first arg)
summarize_contract_task  →  returns { index_content: "...", ai_provider: "..." }
         │
         ▼ (piped as first arg)
process_contract_task
```

---

## Job Tracking

Each task creates a **job document** in the `jobs` MongoDB collection via the `JobManager` class (`utils/helpers.py`).

### Job Document Structure

```json
{
  "_id": "<ObjectId>",
  "job_id": "<uuid>",
  "job_type": "indexing | summarizing | processing",
  "contract_id": "<contract_id>",
  "user_id": "<user_id>",
  "status": "IN_PROGRESS | COMPLETED | FAILED",
  "current_step": "indexing | summarizing | processing",
  "progress": 42.5,
  "error": null,
  "created_at": "<ISO datetime>",
  "updated_at": "<ISO datetime>"
}
```

### Job Status Values

| Status | Description |
|---|---|
| `IN_PROGRESS` | Task is actively running |
| `COMPLETED` | Task finished successfully |
| `FAILED` | Task failed after all retries |

---

## Progress Reporting & WebSocket Integration

Each task calls `job_manager.update_job_status(...)` at key checkpoints. Progress percentages are calculated using named **progress ranges**:

| Stage | Global Range |
|---|---|
| `indexing` | 0% → 30% |
| `summarizing` | 30% → 50% |
| `processing` | 50% → 100% |

The `calculate_stage_progress(stage, local_pct)` helper converts a local per-stage percentage into the global 0–100% scale. Clients subscribe to the WebSocket endpoint (`/api/v1/ws/job-status?token=<JWT>`) to receive live progress updates.

---

## Error Handling & Retries

All tasks are decorated with `bind=True`, allowing access to `self.retry()`. On failure:

1. The exception is logged via `get_task_logger`.
2. The job document is updated to `FAILED` with the error message.
3. The MongoDB contract document gets an error status.
4. `self.retry(exc=e, countdown=60, max_retries=3)` retries the task after 60 seconds, up to 3 times.

If all retries are exhausted, the task moves to the Celery dead-letter queue (if configured).

---

## Security Hardening

The worker implements multiple security layers to safely handle untrusted PDF content:

| Measure | Implementation |
|---|---|
| File size limit | 100 MB max (`MAX_FILE_SIZE`) |
| Filename sanitization | `sanitize_filename()` strips path traversal chars |
| Secure temp directories | `mkdtemp` + `chmod 700` |
| Secure file writes | `chmod 600` on written files |
| Secure file deletion | Files overwritten with random bytes before deletion |
| Input validation | All user inputs checked before processing |
| Redirect prevention | `allow_redirects=False` on all external HTTP calls |
| URL scheme validation | Only `http`/`https` accepted for external API URLs |

---

## Adding a New Task

1. Define the task in `worker/tasks.py`:

```python
@celery_app.task(bind=True, name='my_new_task', max_retries=3)
def my_new_task(self, contract_id: str, user_id: str):
    try:
        # your logic here
        return {"status": "success"}
    except Exception as e:
        raise self.retry(exc=e, countdown=60, max_retries=3)
```

2. Add a queue route in `celery_app.py`:

```python
task_routes={
    ...
    'my_new_task': {'queue': 'default'},
},
```

3. Trigger from the API:

```python
from worker.tasks import my_new_task
my_new_task.apply_async(kwargs={"contract_id": cid, "user_id": uid})
```

---

## Running the Worker

### Development (local)

```bash
cd apps/backend
bash celery_entrypoint.sh
```

Or manually:

```bash
celery -A celery_app worker \
  --loglevel=info \
  -Q default,indexing,summarizing,processing \
  --concurrency=4
```

### production (Container)

The worker runs from `Containerfile.worker`. It is deployed as an **Azure Container App** (separate from the API Container).

---

## Monitoring

### Flower (recommended)

```bash
pip install flower
celery -A celery_app flower --port=5555
```

Open `http://localhost:5555` to view task queues, worker status, and task history.

### CLI

```bash
# Inspect active workers
celery -A celery_app inspect active

# Inspect scheduled tasks
celery -A celery_app inspect scheduled

# Purge a queue (caution!)
celery -A celery_app purge -Q indexing
```
