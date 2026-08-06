<p align="center">
  <img src="./apps/frontend/public/logo.png" alt="ContractSense Logo" width="200" />
</p>

# ContractSense — AI-Powered Contract Analysis Platform

ContractSense is a full-stack application that ingests PDF contracts, converts them to structured markdown via OCR, generates executive summaries via LLM, and performs deep question-answering (RAG) over the document. Results are surfaced in a rich Next.js dashboard with real-time progress via WebSockets.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Repository Layout](#repository-layout)
- [Documentation Index](#documentation-index)
- [Quick Start (Local Dev)](#quick-start-local-dev)
- [Environment Variables](#environment-variables)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)

---

## Architecture Overview

```text
┌──────────────────────────────────────────────────────────────┐
│                          User Browser                        │
│                    Next.js 15 Frontend (4200)                │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP / WebSocket
┌───────────────────────────▼──────────────────────────────────┐
│              FastAPI Backend (Uvicorn · REST & WS)           │
└────────┬──────────────────────────────────────┬──────────────┘
         │ Motor Async / Queries                │ Enqueues Tasks
┌────────▼───────────┐             ┌────────────▼─────────────┐
│  MongoDB Atlas     │             │  RabbitMQ Broker         │
│  (Core Collections)│             │  (or Azure Service Bus)  │
└────────────────────┘             └────────────┬─────────────┘
                                                │ Run Tasks
                              ┌─────────────────▼────────────┐
                              │     Celery Workers           │
                              │  • index_contract_task       │
                              │  • summarize_contract_task   │
                              │  • process_contract_task     │
                              │  • send_beta_welcome_email   │
                              └─┬────────────────────────────┘
                                │ (Pipeline Execution)
      ┌─────────────────────────┼─────────────────────────┐
      │                         │                         │
┌─────▼────────┐        ┌───────▼────────┐        ┌───────▼────────┐
│ 1. Extraction│        │ 2. Embeddings  │        │ 3. Generation  │
│ Marker API   │        │ VoyageAI       │        │ Anthropic /    │
│ Local Marker │        │ OpenAI         │        │ Gemini/OpenAI  │
└─────┬────────┘        └───────┬────────┘        └───────┬────────┘
      │ (Markdown)              │ (Vectors)               │ (Summaries)
      │                 ┌───────▼────────┐                │
      └────────────────►│ 4. Vector DB   │◄───────────────┘
                        │ MongoDB Atlas  │
                        │ Pinecone DB    │
                        └────────────────┘
```

---

## Repository Layout

```
extractor/
├── apps/
│   ├── backend/         # FastAPI application + Celery worker
│   └── frontend/        # Next.js 15 application
├── extractor-chart/     # Helm chart for Kubernetes deployment
├── terraform/           # Infrastructure as Code (Azure)
├── testing/             # Backend tests, evals, E2E tests, benchmarks
├── Jenkinsfile          # CI/CD pipeline
├── docker/              # Environment-specific docker-compose files
├── deploy.sh            # Manual deployment helper
└── setup.sh             # One-time environment bootstrap
```

---

## Documentation Index

| Document | Location | Description |
|---|---|---|
| **Backend** | [`docs/BACKEND.md`](docs/BACKEND.md) | API architecture, routes, modules, auth, models |
| **Frontend** | [`docs/FRONTEND.md`](docs/FRONTEND.md) | Next.js app structure, pages, components, hooks |
| **Background Workers** | [`docs/WORKERS.md`](docs/WORKERS.md) | Celery tasks, queues, brokers, and job lifecycle |
| **Deployment** | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Container builds, CI/CD, Azure environments |
| **API Reference** | [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | All REST & WebSocket endpoints with request/response shapes |
| **Environment Setup** | [`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md) | Every environment variable with defaults and security checklist |
| **Developer Guide** | [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) | Local setup, conventions, and contribution guide |

---

## Quick Start (Local Dev)

### Prerequisites

- **Node.js** ≥ 20, **npm** ≥ 10
- **Python** 3.10 – 3.12
- **Poetry** ≥ 2.0
- **RabbitMQ** running locally (or set `CELERY_BROKER_URL` to a remote instance)
- **MongoDB** running locally or a connection string to Atlas

### 1. Install root dependencies

```bash
npm install
```

### 2. Set up Backend

```bash
cd apps/backend
cp .env.template .env    # fill in required values
poetry install
```

### 3. Set up Frontend

```bash
cd apps/frontend
cp .env.example .env
npm install
```

### 4. Run everything

```bash
# from the repo root
npm run dev:frontend  # Start Next.js frontend
npm run dev:backend   # Start FastAPI backend
```

This starts:
- **Backend** (FastAPI + Uvicorn) on `http://localhost:8000`
- **Frontend** (Next.js) on `http://localhost:4200`
- **Celery Worker** via the `celery_entrypoint.sh` script

### 5. Start Celery worker separately

```bash
cd apps/backend
bash celery_entrypoint.sh
```

---

## Environment Variables

All backend environment variables are defined and typed in [`apps/backend/core/config.py`](apps/backend/core/config.py). Copy `.env.template` to `.env` and fill in the required values.

See the [Deployment documentation](docs/DEPLOYMENT.md) for environment-specific overrides.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS, Radix UI, Framer Motion |
| Backend | FastAPI, Uvicorn, Pydantic v2, Motor (async MongoDB) |
| Task Queue | Celery 5, RabbitMQ (or Azure Service Bus) |
| Vector DB | MongoDB Atlas Vector Search / Pinecone |
| LLMs | Anthropic Claude, Google Gemini, OpenAI GPT, Groq |
| Embeddings | VoyageAI `voyage-law-2`, OpenAI `text-embedding-3-small` |
| PDF Processing | Marker API (external) / local Marker |
| Database | MongoDB Atlas |
| Auth | JWT (HS256), bcrypt via Passlib |
| Payments | Stripe |
| Email | Azure Communication Services |
| CI/CD | Jenkins → Azure Container Registry → Azure App Service / Container Apps |
| IaC | Terraform (Azure) |
| Containers | Docker |

---

## Contributing

1. Create a branch from `dev`: `git checkout -b feature/my-feature dev`
2. Follow the coding conventions in [`DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md)
3. Run linters and tests before opening a PR
4. PRs must target `dev`; `main` is production-only
