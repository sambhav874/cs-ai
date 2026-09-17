# SaaS Contract Management Service Documentation

## Overview

This SaaS service enables users to upload contracts, store them in **Azure Blob Storage**, extract and process contract data using **Marker-PDF**, generate summaries, and analyze contracts for insights. The system supports **role-based access** to ensure security and **version control** for contract summaries and analyses.

## System Requirements

- **Python Version:** 3.10 - 3.12 (Recommended: 3.11)
- **Node.js Version:** 20.x
- **Package Manager:** npm/yarn
- **Standard Monorepo** using npm workspaces
- **Docker** (for containerized deployment)

## Project Setup

### 1. Clone the Repository

```bash
git clone https://github.com/sambhav874/extractor
cd extractor
```

### 2. Backend Setup

```bash
cd backend
python3.11 -m venv venv  # Create Virtual Environment
source venv/bin/activate  # Activate venv (Linux/macOS)
venv\Scripts\activate     # Activate venv (Windows)
```

Install Python dependencies:

```bash
pip install -r requirements.txt
```

### 3. Frontend & Backend Setup

Run the following commands for both frontend and backend:

```bash
npm install                     # Install dependencies
npm run dev:frontend            # Start frontend (Turbopack for performance)
npm run dev:backend             # Start backend
```

#### Alternative Commands

- **Build Frontend:** `npm run build:frontend`
- **Start Frontend:** `npm run start:frontend`
- **Lint Frontend:** `npm run lint:frontend`
- **Start Backend:** `npm run start:backend`

## Environment Setup

Create an `.env` file in the root directory using the provided `.env.template`. This ensures all required environment variables are properly configured.

### Example:

```bash
cp .env.template .env
```

Modify `.env` to match your setup.

## Shared Folder Structure

A `shared` folder should be created in the root directory for commonly used utilities and configurations.

```bash
mkdir -p shared
```

## Business Unit Policies

1. **Role-Based Access Control (RBAC):** Each user belongs to a specific **Business Unit (BU)** with defined roles.
2. **Data Isolation:** Contracts are stored and accessed only within the assigned BU.
3. **Permission Levels:**
   - **Admin:** Full control over contracts and users within a BU.
   - **Manager:** Can review and approve contracts but cannot delete them.
   - **Analyser:** Read-only access to contracts and summaries.
4. **Audit Logs:** All changes and accesses are logged for security and compliance.
5. **Version Control:** Any modifications to contract summaries or analyses must be tracked with version history.

## Docker Setup (Optional)

If you prefer running the service in Docker, use:

```bash
docker-compose build
docker-compose up -d  # Run in detached mode
docker-compose down   # Stop services
```

## Service Flow

1. **User Authentication:** Users log in or sign up.
2. **Contract Upload:** Users upload contracts, stored in **Azure Blob Storage**.
3. **Contract Processing:**
   - **Marker-PDF** extracts raw text.
   - Text embeddings are stored in a **Vector Database**.
4. **Summarization:** AI generates a contract summary.
5. **Analysis & Q&A:** AI extracts clauses and answers contract-related questions.
6. **Version Control:** Contracts, summaries, and analyses are versioned and editable.
7. **Role-Based Access:** Contracts are isolated based on **Business Units & Roles**.

##
