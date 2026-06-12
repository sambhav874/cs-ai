# Platform Architecture

This diagram captures the logical runtime architecture for the ContractLens / ContractSense platform.

For Mermaid-only tools such as Mermaid Live Editor, paste only the diagram code inside a fenced block, or use the raw files:

- [platform-architecture.mmd](platform-architecture.mmd)
- [contract-processing-flow.mmd](contract-processing-flow.mmd)

```mermaid
graph LR
  U["Users / Teams"] --> FE["Next.js Frontend<br/>Dashboard, Contracts, KPIs, Agent, Reports"]
  FE -->|"REST /api/v1 + JWT"| API
  FE <-->|"WebSocket job updates"| WS

  subgraph Backend["FastAPI Backend"]
    API["API Routers<br/>contracts, projects, teams, billing, audit"]
    Auth["Auth & Security<br/>JWT, CORS, rate limits, headers"]
    Services["Business Services<br/>KPIs, playbooks, reports, support"]
    Agent["ContractSense Agent<br/>LangGraph ReAct, scoped tools, approvals"]
    RAG["RAG Layer<br/>segment, embed, retrieve, cite, verify"]
    Artifacts["Artifact Services<br/>DOCX, redlines, tabular reviews"]
    WS["WS Router<br/>MongoDB job change stream"]

    API --> Auth
    API --> Services
    API --> Agent
    Agent --> RAG
    Agent --> Artifacts
    Services --> RAG
  end

  subgraph Async["Async Processing"]
    Broker["RabbitMQ<br/>or Azure Service Bus"]
    Queues["Celery Queues<br/>default, indexing, kpi_ingestion, email/report"]
    Worker["Celery Workers<br/>PDF indexing, KPI source fetches, emails, reports"]

    Broker --> Queues --> Worker
  end

  subgraph Data["Persistence"]
    Mongo["MongoDB Atlas<br/>contracts, users, teams, projects, jobs, audit, KPIs, agent memory"]
    GridFS["GridFS<br/>PDF uploads and DOCX artifacts"]
    Vectors["Vector Store<br/>MongoDB Atlas Vector Search or Pinecone"]
  end

  subgraph External["External Providers"]
    OCR["Marker API / local Marker / LiteParse"]
    Embeddings["VoyageAI / OpenAI Embeddings"]
    LLMs["Anthropic / Gemini / OpenAI / Groq"]
    Stripe["Stripe Billing"]
    Email["Azure Communication Services Email"]
    Sources["KPI Sources<br/>CSV, XLSX, REST, webhooks, SaaS"]
  end

  subgraph Deploy["Deployment"]
    ACR["Azure Container Registry<br/>built by Jenkins"]
    FrontDeploy["Azure Static Web Apps<br/>or Next.js container"]
    ApiDeploy["Azure App Service<br/>or Helm backend deployment"]
    WorkerDeploy["Azure Container Apps<br/>or worker containers"]

    ACR --> FrontDeploy
    ACR --> ApiDeploy
    ACR --> WorkerDeploy
  end

  API --> Mongo
  API --> GridFS
  API --> Broker
  API --> Stripe
  API --> Email

  Worker --> Mongo
  Worker --> GridFS
  Worker --> OCR
  Worker --> RAG

  RAG --> Embeddings
  RAG --> Vectors
  RAG --> LLMs

  Services --> Mongo
  Services --> Sources
  Agent --> Mongo
  Agent --> LLMs
  WS --> Mongo
```

## Contract Processing Flow

```mermaid
sequenceDiagram
  actor User
  participant FE as Next.js Frontend
  participant API as FastAPI API
  participant DB as MongoDB + GridFS
  participant Broker as RabbitMQ / Azure Service Bus
  participant Worker as Celery Worker
  participant OCR as Marker / LiteParse
  participant Vec as Vector Store
  participant Agent as ContractSense Agent
  participant LLM as LLM Providers

  User->>FE: Upload PDF
  FE->>API: POST /api/v1/upload
  API->>DB: Store contract metadata and PDF
  API->>Broker: Queue indexing task
  API-->>FE: Return contract id and queued status
  FE->>API: Open WebSocket job subscription

  Broker->>Worker: Dispatch indexing task
  Worker->>DB: Read PDF from GridFS
  Worker->>OCR: Extract markdown / structured text
  Worker->>Vec: Segment and embed contract text
  Worker->>DB: Save index content and job status
  API-->>FE: Push job updates over WebSocket

  User->>FE: Ask contract question or request artifact
  FE->>API: POST agent query
  API->>Agent: Run scoped agent workflow
  Agent->>Vec: Search evidence
  Agent->>DB: Read scoped contract, KPI, memory, artifact data
  Agent->>LLM: Generate answer or proposal
  Agent-->>API: Return cited answer or approval request
  API-->>FE: Render answer, trace, artifact, or approval UI
```
