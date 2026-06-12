# Deployment Documentation

This document covers all deployment environments, container builds, CI/CD pipeline, and infrastructure. Three deployment strategies are supported:

1. **[Primary] Azure App Service + Container App + Coolify RabbitMQ** — the canonical production setup
2. **[Alternative] VM-based self-hosted** — full control on a single or multi-VM setup
3. **[Alternative] Kubernetes via Helm** — container-orchestrated, horizontally scalable

---

## Table of Contents

- [Environments](#environments)
- [Container Images](#container-images)
- [Deployment Strategy 1 — Azure (Primary)](#deployment-strategy-1--azure-primary)
- [Deployment Strategy 2 — Virtual Machine](#deployment-strategy-2--virtual-machine)
- [Deployment Strategy 3 — Kubernetes (Helm)](#deployment-strategy-3--kubernetes-helm)
- [CI/CD Pipeline (Jenkins)](#cicd-pipeline-jenkins)
- [Environment-Specific Compose Files](#environment-specific-compose-files)
- [Secrets Management (SOPS)](#secrets-management-sops)
- [Troubleshooting](#troubleshooting)

---

## Environments

| Environment | Branch | Description |
|---|---|---|
| **Development** | `dev` | Azure dev resources, staging config |
| **Production** | `main` | Azure production resources |

Both environments push images to **Azure Container Registry** at `contractlens.azurecr.io`.

---

## Container Images

### Backend API (`Containerfile`)

```bash
docker build \
  --build-arg ENVIRONMENT=prod \
  -t backend:latest \
  -f apps/backend/Containerfile .
```

- Runs via `entrypoint.sh` (Gunicorn + Uvicorn workers)
- Exposes port `8000`

### Celery Worker (`Containerfile.worker`)

```bash
docker build \
  --build-arg ENVIRONMENT=prod \
  -t celery-worker:latest \
  -f apps/backend/Containerfile.worker .
```

- Runs via `celery_entrypoint.sh`
- No exposed port

### Frontend (`Containerfile`)

```bash
# from apps/frontend/
docker build -t frontend:latest -f Containerfile .
```

- Multi-stage Node.js build
- Output: production Next.js server on port `4200`
- For Azure Static Web Apps, the Next.js output is deployed as a static bundle or hybrid

---

## Deployment Strategy 1 — Azure (Primary)

This is the canonical production and development deployment.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Azure (Primary Setup)                        │
│                                                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │  Azure Static Web App    │  │  Azure App Service           │ │
│  │  (Frontend — Next.js)    │──│  (Backend — FastAPI)         │ │
│  └──────────────────────────┘  └──────────────┬───────────────┘ │
│                                               │ Celery tasks    │
│  ┌──────────────────────────┐  ┌──────────────▼───────────────┐ │
│  │  MongoDB Atlas           │  │  Azure Container App         │ │
│  │  (Primary Database)      │  │  (Celery Worker)             │ │
│  └──────────────────────────┘  └──────────────┬───────────────┘ │
│                                               │ AMQP            │
│                               ┌──────────────▼───────────────┐  │
│                               │  RabbitMQ on Coolify         │  │
│                               │  (Message Broker)            │  │
│                               └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend — Azure Static Web Apps

The Next.js frontend is deployed to **Azure Static Web Apps**, which handles global CDN distribution, SSL certificates, and CI/CD integration.

**One-time setup:**

```bash
# Install the SWA CLI
npm install -g @azure/static-web-apps-cli

# Link to your Azure Static Web App resource
swa init
```

**From the Azure Portal:**
1. Create a Static Web App resource
2. Connect it to your GitHub/Azure DevOps repository (branch: `main` or `dev`)
3. Set the app location to `apps/frontend`
4. Set the output location to `.next` (or `out` for full static export)
5. Azure automatically provisions GitHub Actions / Azure Pipelines for CI/CD

**Manual deploy:**
```bash
cd apps/frontend
npm run build
swa deploy .next --deployment-token <TOKEN>
```

**Environment variable (in SWA settings):**

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Full URL of the deployed Azure App Service backend |

---

### Backend — Azure App Service

The FastAPI app runs as a Docker container on **Azure App Service**.

**Deploy a new image version:**
```bash
az webapp config container set \
  --name contractsense \
  --resource-group ContractSense_StaticApp1 \
  --docker-custom-image-name contractlens.azurecr.io/backend:v42 \
  --docker-registry-server-url https://contractlens.azurecr.io

az webapp restart --name contractsense --resource-group ContractSense_StaticApp1
```

**App Service configuration:**
- All environment variables are set in Azure Portal → App Service → Configuration → Application Settings
- Set `WEBSITES_PORT=8000` so Azure routes traffic correctly
- Enable **always-on** to prevent cold starts

| Azure Resource | Dev | Production |
|---|---|---|
| App Service | `contractsensedev` | `contractsense` |
| Resource Group | `ContractSense_Dev` | `ContractSense_StaticApp1` |
| Image repo | `backend-dev` | `backend` |

---

### Celery Worker — Azure Container Apps

Workers run as an **Azure Container App**, which scales automatically based on queue depth.

**Deploy a new worker image:**
```bash
az containerapp update \
  --name contractsenseworkers \
  --resource-group ContractSense_StaticApp1 \
  --image contractlens.azurecr.io/workers:v42
```

| Azure Resource | Dev | Production |
|---|---|---|
| Container App | `contractsensedevworkers` | `contractsenseworkers` |

---

### Message Broker — RabbitMQ on Coolify

RabbitMQ is **self-hosted on [Coolify](https://coolify.io)** (a self-hostable PaaS). This avoids Azure Service Bus costs while retaining a managed experience.

**Setup on Coolify:**
1. Log in to your Coolify instance
2. Create a new service → select **RabbitMQ** from the marketplace
3. Set a username, password, and expose the AMQP port (`5672`)
4. Optionally enable the management UI on port `15672`
5. Copy the connection URL provided by Coolify

**Set the broker URL on both the App Service and Container App:**
```
CELERY_BROKER_URL=amqp://<user>:<password>@<coolify-host>:5672/
```

> **Tip**: Use a vhost per environment (e.g., `/dev` and `/prod`) to isolate queues:
> `amqp://user:pass@coolify-host:5672/dev`

---

## Deployment Strategy 2 — Virtual Machine

Choose this if you want complete self-hosted control without Kubernetes or a cloud PaaS.

```
┌──────────────────────────────────────────────────┐
│                  Linux VM (Ubuntu 22.04)         │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Nginx    │  │ FastAPI  │  │ Celery Worker  │  │
│  │ (Reverse │─▶│ (port    │  │ (systemd       │  │
│  │  Proxy)  │  │  8000)   │  │  service)      │  │
│  └──────────┘  └──────────┘  └────────────────┘  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ RabbitMQ │  │ MongoDB  │  │ Next.js        │  │
│  │ (Docker) │  │ (Docker) │  │ (port 4200)    │  │
│  └──────────┘  └──────────┘  └────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Prerequisites

```bash
# Install Docker and Docker Compose
sudo apt update && sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker

# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Python 3.11 + Poetry
sudo apt install -y python3.11 python3.11-venv
curl -sSL https://install.python-poetry.org | python3 -

# Install Nginx
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 1. Clone and configure

```bash
git clone <your-repo-url> /opt/contractlens
cd /opt/contractlens
cp apps/backend/.env.template apps/backend/.env
# Edit apps/backend/.env with your values
cp apps/frontend/.env.example apps/frontend/.env
# Set NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

### 2. Start infrastructure services (RabbitMQ + MongoDB)

```bash
# Use the backend docker-compose file:
docker run -d --name rabbitmq \
  -p 5672:5672 -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=changeme \
  rabbitmq:3-management

docker run -d --name mongodb \
  -p 27017:27017 \
  -v /data/mongodb:/data/db \
  mongo:7
```

### 3. Start the backend

```bash
cd /opt/contractlens/apps/backend
poetry install
# Option A: direct uvicorn
poetry run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# Option B: via Gunicorn (production)
poetry run gunicorn main:app -k uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 --workers 4
```

**As a systemd service** (`/etc/systemd/system/contractlens-api.service`):

```ini
[Unit]
Description=ContractLens API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/contractlens/apps/backend
EnvironmentFile=/opt/contractlens/apps/backend/.env
ExecStart=/home/ubuntu/.local/bin/poetry run gunicorn main:app \
  -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --workers 4
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now contractlens-api
```

### 4. Start the Celery worker

**As a systemd service** (`/etc/systemd/system/contractlens-worker.service`):

```ini
[Unit]
Description=ContractLens Celery Worker
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/contractlens/apps/backend
EnvironmentFile=/opt/contractlens/apps/backend/.env
ExecStart=/home/ubuntu/.local/bin/poetry run celery \
  -A celery_app worker --loglevel=info \
  -Q default,indexing,summarizing,processing --concurrency=4
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now contractlens-worker
```

### 5. Build and start the frontend

```bash
cd /opt/contractlens/apps/frontend
npm install
npm run build
npm start -- -p 4200   # or use pm2: pm2 start npm -- start
```

### 6. Nginx reverse proxy

`/etc/nginx/sites-available/contractlens`:

```nginx
server {
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    server_name yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:4200;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/contractlens /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL via Let's Encrypt
sudo certbot --nginx -d yourdomain.com -d api.yourdomain.com
```

---

## Deployment Strategy 3 — Kubernetes (Helm)

Use the Helm chart in `extractor-chart/` for a fully orchestrated deployment. Recommended for multi-tenant, high-availability, or auto-scaling requirements.

### Chart Structure

```
extractor-chart/
├── Chart.yaml           # Chart metadata and version
├── values.yaml          # Default configuration values
└── templates/           # Kubernetes manifest templates (Deployments, Services, Ingress)
```

### Prerequisites

- A running Kubernetes cluster (AKS, EKS, GKE, or self-hosted k3s)
- `kubectl` configured against the cluster
- `helm` v3 installed
- An image registry accessible from the cluster (e.g., ACR)
- A RabbitMQ instance accessible from within the cluster (can be deployed via the [Bitnami Helm chart](https://github.com/bitnami/charts/tree/main/bitnami/rabbitmq))

### 1. Deploy RabbitMQ (if not already available)

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install rabbitmq bitnami/rabbitmq \
  --namespace contractlens \
  --create-namespace \
  --set auth.username=admin \
  --set auth.password=changeme
```

### 2. Install the ContractLens chart

```bash
helm install contractlens ./extractor-chart \
  --namespace contractlens \
  --create-namespace \
  --set backend.image.repository=contractlens.azurecr.io/backend \
  --set backend.image.tag=v42 \
  --set worker.image.repository=contractlens.azurecr.io/workers \
  --set worker.image.tag=v42 \
  --set frontend.image.repository=contractlens.azurecr.io/frontend \
  --set frontend.image.tag=v42 \
  --set env.MONGODB_URI="mongodb+srv://..." \
  --set env.CELERY_BROKER_URL="amqp://admin:changeme@rabbitmq:5672/"
```

### 3. Upgrade after a new image version

```bash
helm upgrade contractlens ./extractor-chart \
  --namespace contractlens \
  --set backend.image.tag=v43 \
  --set worker.image.tag=v43
```

### 4. Key `values.yaml` Options

| Key | Description |
|---|---|
| `backend.replicaCount` | Number of API replicas |
| `backend.image.repository` | Backend Docker image |
| `backend.image.tag` | Image version tag |
| `worker.replicaCount` | Number of Celery worker replicas |
| `worker.image.repository` | Worker Docker image |
| `frontend.image.repository` | Frontend Docker image |
| `ingress.enabled` | Enable Kubernetes Ingress |
| `ingress.host` | Domain for the Ingress resource |

### 5. Rollback

```bash
helm rollback contractlens 1   # roll back to revision 1
```

---

## CI/CD Pipeline (Jenkins)

The `Jenkinsfile` at the repo root defines an automated pipeline for Strategy 1 (Azure). It triggers on pushes to `dev` and `main`.

### Pipeline Stages

```
Checkout → Azure Login → Get Latest Image Version
→ Docker Build & Tag → Push to ACR → Azure Deploy → Cleanup
```

### Branch → Environment Mapping

| Branch | Backend Image | Worker Image | Deploy Target |
|---|---|---|---|
| `dev` | `backend-dev:vN` | `workers-dev:vN` | Dev App Service + Dev Container App |
| `main` | `backend:vN` | `workers:vN` | Prod App Service + Prod Container App |

### Required Jenkins Credentials

| Credential ID | Type | Description |
|---|---|---|
| `AZURE_CLIENT_ID` | Secret string | Service principal client ID |
| `AZURE_CLIENT_SECRET` | Secret string | Service principal secret |
| `AZURE_TENANT_ID` | Secret string | Azure AD tenant ID |
| `docker-credentials-id` | Username/Password | ACR username + password |

### Versioning

Images are tagged with sequential version numbers (`v1`, `v2`, ...) queried from ACR. Each deployment always increments to the next version, creating a clear rollback history.

---

## Environment-Specific Compose Files

For running the system locally the Docker Compose files provide environment-specific configurations. All files are located in the `docker/` directory at the repo root.

| File | Purpose |
|---|---|
| `docker/docker-compose.backend.yml` | Backend API only |
| `docker/docker-compose.dev.backend.yml` | Backend in dev mode (hot reload) |
| `docker/docker-compose.dev.frontend.yml` | Frontend in dev mode |
| `docker/docker-compose.frontend.yml` | Frontend production build |
| `docker/docker-compose.prod.backend.yml` | Backend production mode |
| `docker/docker-compose.prod.frontend.yml` | Frontend production mode |
| `docker/docker-compose.staging.backend.yml` | Backend staging mode |
| `docker/docker-compose.staging.frontend.yml` | Frontend staging mode |

**Example usage:**

```bash
# Backend only
docker compose -f docker/docker-compose.backend.yml up --build

# Backend + frontend dev
docker compose -f docker/docker-compose.backend.yml -f docker/docker-compose.dev.frontend.yml up --build
```

---

## Secrets Management (SOPS)

The `.sops.yaml` at the repo root configures **SOPS** for encrypting secrets at rest.

```bash
# Encrypt
sops --encrypt secrets.yaml > secrets.enc.yaml

# Decrypt
sops --decrypt secrets.enc.yaml > secrets.yaml
```

Encrypted files can be safely committed to the repository.

---

## Troubleshooting

### Azure App Service not picking up new image

```bash
az webapp restart --name <app-name> --resource-group <rg>
```

### Worker not connecting to RabbitMQ

Verify the broker URL is correctly set:

```bash
# Azure Container App
az containerapp show --name <worker-name> --resource-group <rg> \
  --query "properties.template.containers[0].env"
```

Test the RabbitMQ connection directly from the worker container:

```bash
python -c "import pika; pika.BlockingConnection(pika.URLParameters('amqp://...'))"
```

### View live App Service logs

```bash
az webapp log tail --name <app-name> --resource-group <rg>
```

### View live Container App logs

```bash
az containerapp logs show --name <worker-name> --resource-group <rg> --follow
```

### Roll back to a previous image version

```bash
# Backend (Azure App Service)
az webapp config container set \
  --name contractsense \
  --resource-group ContractSense_StaticApp1 \
  --docker-custom-image-name contractlens.azurecr.io/backend:v39 \
  --docker-registry-server-url https://contractlens.azurecr.io
az webapp restart --name contractsense --resource-group ContractSense_StaticApp1

# Worker (Azure Container App)
az containerapp update \
  --name contractsenseworkers \
  --resource-group ContractSense_StaticApp1 \
  --image contractlens.azurecr.io/workers:v39

# Kubernetes
helm rollback contractlens 1
```
