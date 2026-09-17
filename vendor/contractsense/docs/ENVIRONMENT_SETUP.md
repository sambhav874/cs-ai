# Environment Setup Guide

This document lists every environment variable used across the ContractLens platform, grouped by service, with descriptions and example values.

---

## Backend Environment Variables

Copy `apps/backend/.env.template` to `apps/backend/.env` and fill in these values before starting the backend locally.

### 🔑 Required (no defaults)

| Variable | Description | Example |
|---|---|---|
| `HUGGINGFACE_TOKEN` | HuggingFace API token for model access | `hf_abc123...` |
| `GROQ_API_KEY` | Groq LLM API key | `gsk_...` |
| `SECRET_KEY` | JWT signing secret (use a long random string) | `openssl rand -hex 32` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/db` |
| `FINAL_OUTPUT_DIR` | Directory for final extracted data | `/shared/final_extracted_data` |
| `SUPPORT_EMAIL_ADDRESS` | Email shown to users for support contact | `support@contractlens.io` |
| `AZURE_COMMUNICATION_CONNECTION_STRING` | Azure Communication Services connection string | `endpoint=https://...;accesskey=...` |
| `AZURE_SENDER_ADDRESS` | Azure verified sender email address | `DoNotReply@contractlens.azurecomm.net` |

---

### 🤖 LLM Providers

At least one of these must be configured for contract processing.

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | `""` | Anthropic Claude API key |
| `ANTHROPIC_MODEL_NAME` | `claude-haiku-4-5` | Claude model to use |
| `CLAUDE_STRICT_MODE` | `false` | Enable strict Claude output parsing |
| `GEMINI_API_KEY` | `""` | Google Gemini API key |
| `GEMINI_MODEL_NAME` | `gemini-2.0-flash` | Gemini model to use |
| `GEMINI_API_URL` | `https://generativelanguage.googleapis.com/...` | Gemini API endpoint |
| `OPENAI_API_KEY` | `""` | OpenAI API key |
| `OPENAI_MODEL_NAME` | `gpt-4-turbo-preview` | OpenAI model to use |
| `GROQ_STRICT_MODE` | `false` | Enable strict Groq output parsing |

---

### 🗄️ Vector Database & Embeddings

| Variable | Default | Description |
|---|---|---|
| `USE_MONGODB_VECTOR` | `true` | Use MongoDB Atlas Vector Search (Primary) |
| `MONGODB_VOYAGE_API_KEY` | `""` | Atlas Model API Key for Voyage AI (Primary embeddings) |
| `MONGODB_VOYAGE_MODEL_NAME` | `voyage-3-large` | Voyage AI model for MongoDB integration |
| `MONGODB_VOYAGE_API_BASE` | `https://ai.mongodb.com/v1` | Atlas endpoint for Voyage AI embeddings |
| `MONGODB_DB_NAME` | `contract_analysis` | MongoDB database for vector storage |
| `MONGODB_COLLECTION_NAME` | `contract_vectors` | MongoDB collection for vectors |
| `MONGODB_VECTOR_INDEX_NAME` | `vector_index` | Name of the Atlas Vector Search index |
| `PINECONE_API_KEY` | `""` | Pinecone API key (Secondary fallback) |
| `PINECONE_INDEX_NAME` | `""` | Name of the Pinecone index |
| `CLEANUP_PINECONE_NAMESPACE` | `true` | Delete contract namespace after processing |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embeddings model |
| `OPENAI_EMBED_DIM` | `1536` | Embedding vector dimensions |
| `VOYAGEAI_API_KEY` | `""` | VoyageAI API key (Fallback direct access) |
| `VOYAGEAI_MODEL_NAME` | `voyage-law-2` | VoyageAI embedding model (Fallback) |

---

### 📄 PDF Processing (Marker)

| Variable | Default | Description |
|---|---|---|
| `MARKER_API_KEY` | `None` | External Marker API key (datalab.to) |
| `MARKER_API_URL` | `https://www.datalab.to/api/v1/marker` | Marker API endpoint |

If `MARKER_API_KEY` is not set and `use_local_marker=true` is requested, the local Marker library will be used (requires the `ml` poetry extra: `poetry install -E ml`).

---

### ⚙️ API Server

| Variable | Default | Description |
|---|---|---|
| `API_HOST` | `0.0.0.0` | Host to bind the API server |
| `API_PORT` | `8000` | Port for the API server |
| `API_TIMEOUT` | `30` | Request timeout in seconds |
| `API_RATE_LIMIT` | `10` | Rate limit (requests per period) |
| `ALLOWED_ORIGINS` | `http://localhost:4200` | Comma-separated CORS allowed origins |

---

### 🔐 Auth & Security

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | **required** | JWT HMAC signing secret |
| `ALGORITHM` | `HS256` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | JWT expiration time in minutes |
| `ENABLE_SSL` | `true` | Enforce HTTPS |

---

### 🧵 Celery (Background Workers)

| Variable | Default | Description |
|---|---|---|
| `CELERY_BROKER_URL` | `amqp://guest:guest@localhost:5672//` | Message broker URL (RabbitMQ / Azure Service Bus) |
| `CELERY_RESULT_BACKEND` | `rpc://` | Task result backend URL |
| `USE_AZURE_SERVICE_BUS` | `false` | Use Azure Service Bus as broker |
| `SERVICE_BUS_NAMESPACE` | — | Azure Service Bus namespace |
| `SERVICE_BUS_SAS_POLICY_NAME` | — | Azure SAS policy name |
| `SERVICE_BUS_SAS_KEY` | — | Azure SAS key |
| `USE_AZURE_BLOB_STORAGE` | `false` | Use Azure Blob Storage as result backend |
| `AZURE_STORAGE_CONNECTION_STRING` | — | Azure Blob Storage connection string |

---

### 💳 Stripe (Payments)

| Variable | Default | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | `""` | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | `""` | Stripe webhook endpoint secret |
| `DOMAIN` | `http://localhost:4200` | Base URL used in Stripe redirect URLs |

---

### 🤖 Model Configuration (optional local LLM)

| Variable | Default | Description |
|---|---|---|
| `MODEL_NAME` | `meta-llama/Llama-3.2-1B` | Primary model (local HuggingFace) |
| `FALLBACK_MODEL_NAME` | `meta-llama/Llama-3.2-1B` | Fallback model |
| `USE_GPU` | `false` | Enable GPU inference |
| `MAX_TOKENS` | `2048` | Max tokens in LLM responses |
| `TEMPERATURE` | `0.1` | LLM sampling temperature |
| `TOP_P` | `0.95` | Nucleus sampling probability |
| `FREQUENCY_PENALTY` | `1.15` | Repetition penalty |
| `EMBEDDINGS_MODEL_NAME` | `intfloat/e5-large-v2` | Local embeddings model |
| `MODEL_CACHE_DIR` | `./model_cache` | Directory to cache downloaded models |

---

### 📝 Logging & Debug

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warning`, `error`) |
| `LOG_FILE` | `./contract_rag.log` | Log file path |
| `DEBUG_MODE` | `false` | Enable FastAPI debug mode |
| `DEV_MODE` | `false` | Enable development-specific behaviour |
| `TESTING` | `false` | Load `testing/backend/.env.test` and mount testing routes |

---

### 📦 Processing

| Variable | Default | Description |
|---|---|---|
| `THREAD_POOL_WORKERS` | `4` | Thread pool size for concurrent operations |
| `CHUNK_SIZE` | `4000` | Text chunk size in characters |
| `CHUNK_OVERLAP` | `200` | Overlap between consecutive chunks |
| `BATCH_SIZE` | `6` | Batch size for LLM calls |

---

## Frontend Environment Variables

Copy `apps/frontend/.env.example` to `apps/frontend/.env`.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Full base URL of the backend API (e.g., `http://localhost:8000`) |

---

## Environment-Specific Notes

### Local Development
- Use `amqp://guest:guest@localhost:5672//` for RabbitMQ (default Docker/Podman setup)
- Use `mongodb://localhost:27017/contractlens` for a local MongoDB instance
- Set `TESTING=false` unless running automated tests

### Staging / Production
- All secrets must be injected via Azure App Service / Container App settings, **not** via `.env` files
- Use `ALLOWED_ORIGINS` to restrict CORS to your frontend domain(s)
- Set `ENABLE_SSL=true`
- Use strong random values for `SECRET_KEY` (minimum 32 bytes)

### Security Checklist Before Going Live
- [ ] `SECRET_KEY` is random and not shared between environments
- [ ] `DEBUG_MODE=false` and `DEV_MODE=false`
- [ ] `TESTING=false`
- [ ] `ALLOWED_ORIGINS` lists only your actual frontend domains
- [ ] All API keys are scoped with minimum required permissions
- [ ] Stripe webhook secret is configured and checked
