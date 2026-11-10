# KnowledgeHub Backend (Dify Wrapper API)

[![NestJS](https://img.shields.io/badge/NestJS-10.0-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.10-2D3748?style=flat&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?style=flat&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.1-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)

KnowledgeHub Backend is an enterprise-grade backend service built on top of **NestJS** and **Prisma ORM**. It acts as an intelligent orchestration, management, and security wrapper for the **Dify AI Platform**, offering enterprise multi-level access control (RBAC), hierarchical category trees with vector embeddings, asynchronous document parsing pipelines (OCR/VLM), and conversational AI management with real-time streaming and human-in-the-loop annotations.

---

## Table of Contents

- [Key Features](#key-features)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Running with Docker Compose](#running-with-docker-compose)
- [Environment Configuration](#environment-configuration)
- [API Documentation](#api-documentation)
- [Project Structure](#project-structure)
- [Diagnostic Scripts](#diagnostic-scripts)
- [License](#license)

---

## Key Features

### 1. Enterprise RBAC & Data Isolation
- **Role Hierarchy**: `SUPER_ADMIN`, `DEPT_MANAGER`, and `MEMBER`.
- **Department Partitioning**: Datasets and categories can be partitioned per department or shared globally.
- **Granular Dataset Permissions**: `VIEWER`, `EDITOR`, and `MANAGER` roles assigned individually or by department.
- **SSO Authentication**: Corporate single sign-on (SSO) integration with automatic user synchronization and JWT issuance.

### 2. Hierarchical Categories & Semantic Vector Routing
- **Infinite Tree Structure**: Unlimited nested categories for organizing enterprise knowledge bases.
- **Automatic Vector Embeddings**: Seamless embedding generation via Ollama (`embeddinggemma`) on category creation/updates.
- **Semantic Routing (POC)**: Uses PostgreSQL `pgvector` cosine similarity (`<=>`) to dynamically match user queries to the most relevant knowledge categories.
- **Batch Vector Synchronization**: Administrative tool to re-index all category embeddings.

### 3. Dify AI Platform Integration
- **Dataset Synchronization**: Create, update, soft-delete, and permission-gate datasets mirrored in Dify.
- **Document & Chunk Management**: Upload documents, manage segments (chunks), and trigger retrieval tests.
- **Chatbot Auto-Discovery**: Cross-queries Dify's PostgreSQL database to automatically identify chatbots linked to user-authorized datasets.
- **Streaming Conversations**: Real-time Server-Sent Events (SSE) streaming proxy for interactive AI chat sessions.

### 4. Advanced Asynchronous Document Processing Pipeline
- **Multi-Format Ingestion**: Supports PDF, DOCX, PPTX, XLSX, CSV, TXT, and image files.
- **Office Conversion**: Converts Microsoft Office documents to PDF using Gotenberg.
- **VLM / OCR Parsing**: Vision Language Model (VLM) and OCR extraction for text, tables, and complex figures.
- **Background Job Queue**: Asynchronous processing managed by `pg-boss` (PostgreSQL job queue) to handle heavy file operations reliably without blocking HTTP requests.

### 5. Annotations & Human-in-the-Loop Feedback
- **Message Feedback**: User rating support (`LIKE` / `DISLIKE`) on AI chatbot answers.
- **Annotation Workflow**: Admins and editors can draft, review, and publish corrections for inaccurate responses.
- **Dataset Re-training**: Directly insert approved corrections back into target Dify datasets for continuous model improvement.

---

## Architecture & Tech Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| **Core Framework** | NestJS (Node.js, Express) | Modular TypeScript backend architecture |
| **Database** | PostgreSQL 15 + `pgvector` | Relational data storage & vector similarity search |
| **ORM** | Prisma ORM | Type-safe database queries & migrations |
| **Caching & Pub/Sub** | Redis (ioredis) | Session caching and rate limiting |
| **Job Queue** | pg-boss | Asynchronous job management on PostgreSQL |
| **Office Conversion** | Gotenberg | Dockerized headless Chromium & LibreOffice converter |
| **Local LLM / Embeddings** | Ollama (`embeddinggemma`) | Vector embedding generation |
| **AI Engine** | Dify AI Platform | External LLM orchestration, agent workflows & RAG |
| **API Docs** | Swagger (OpenAPI 3.0) | Interactive documentation at `/api` |

---

## Prerequisites

- **Node.js**: `v18.x` or higher (recommended: Node 20 LTS)
- **Package Manager**: `npm` (v9+)
- **PostgreSQL**: PostgreSQL 15+ with `pgvector` extension enabled
- **Redis**: Redis 6+
- *(Optional)* **Docker & Docker Compose**: For containerized deployment

---

## Installation & Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd knowledgehub_be
```

### 2. Configure Environment Variables
Duplicate the example configuration file:
```bash
cp .env.example .env
```
Edit `.env` and fill in the database credentials, Dify credentials, and external service URLs.

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Setup & Prisma Migration
Generate the Prisma Client and run migrations:
```bash
# Generate Prisma Client
npm run prisma:generate

# Apply database migrations
npm run prisma:migrate
```

*(Optional)* Launch Prisma Studio to inspect database records:
```bash
npm run prisma:studio
```

### 5. Run the Application

```bash
# Development mode (with hot-reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

Once started, the API will be available at:
- **Server**: `http://localhost:9000`
- **Swagger Documentation**: `http://localhost:9000/api`

---

## Running with Docker Compose

A complete multi-container setup (API, PostgreSQL with pgvector, Redis, and Gotenberg) is provided via `docker-compose.yml`:

```bash
# Build and run all services in the background
docker compose up -d --build

# View container logs
docker compose logs -f api

# Stop all services
docker compose down
```

### Included Containers
- `api`: KnowledgeHub NestJS application (port `9000`)
- `db`: PostgreSQL 15 with `pgvector` (port `5433` on host -> `5432` in container)
- `redis`: Redis server (port `6379`)
- `gotenberg`: Gotenberg conversion engine (port `3003` on host -> `3000` in container)

---

## Environment Configuration

All configurable values are centralized in `.env`. Below is a reference of available variables:

| Variable | Default / Example | Required | Description |
|----------|-------------------|----------|-------------|
| `PORT` | `9000` | No | Port on which the NestJS application listens |
| `HOST` | `0.0.0.0` | No | Host address binding (use `0.0.0.0` for containers) |
| `DATABASE_URL` | `postgresql://admin:123456@localhost:5433/knowbase_db?schema=public` | **Yes** | PostgreSQL connection URL with pgvector support |
| `JWT_SECRET` | `secretKey` | **Yes** | Secret key for signing and verifying JWT tokens |
| `LOGIN_URL` | `http://.../api/auth/login` | No | Corporate SSO / LDAP authentication endpoint |
| `EXTERNAL_USER_SEARCH_URL` | `http://.../api/emp/getAllEmployeeBySearch` | No | External API for employee lookups by keyword |
| `DIFY_API_URL` | `http://...:8081/v1` | **Yes** | Base endpoint for the Dify Platform API |
| `DIFY_API_KEY` | `dataset-...` | **Yes** | API key / dataset token for Dify Platform integration |
| `DIFY_APP_API_KEY` | `app-...` | No | App-specific API key for chatbot streaming |
| `DIFY_ADMIN_EMAIL` | `admin@example.com` | No | Dify Admin console email for automated sync |
| `DIFY_ADMIN_PASSWORD` | `password` | No | Dify Admin console password |
| `DIFY_DB_HOST` | `localhost` | No | Dify PostgreSQL host for direct cross-database queries |
| `DIFY_DB_PORT` | `5432` | No | Dify PostgreSQL port |
| `DIFY_DB_USER` | `postgres` | No | Dify PostgreSQL username |
| `DIFY_DB_PASSWORD` | `...` | No | Dify PostgreSQL password |
| `DIFY_DB_NAME` | `dify` | No | Dify database name |
| `REDIS_HOST` | `localhost` | No | Host for Redis cache |
| `REDIS_PORT` | `6379` | No | Port for Redis cache |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | No | Endpoint for Ollama embedding & LLM service |
| `UPLOAD_DIR` | `./uploads` | No | Path to store uploaded files |
| `GOTENBERG_URL` | `http://localhost:3003` | No | Gotenberg service endpoint for document conversion |
| `GOTENBERG_TIMEOUT_MS`| `120000` | No | Timeout for Gotenberg conversion in milliseconds |
| `OCR_API_URL` | `http://...:10002/ocr/run` | No | External OCR / Vision Language Model endpoint |
| `OCR_TEMPLATE_ID` | `imageocr` | No | Template alias used for OCR processing |
| `OCR_TEMPERATURE` | `0` | No | Sampling temperature for OCR inference |
| `OCR_TIMEOUT_MS` | `180000` | No | Request timeout for OCR processing in milliseconds |
| `OCR_MAX_ATTEMPTS` | `2` | No | Maximum retry attempts for failed OCR calls |

---

## API Documentation

When the application runs, visit the interactive Swagger UI at:
```
http://localhost:9000/api
```

### Key API Modules

- **Auth** (`/auth`)
  - `POST /auth/login`: Authenticate with corporate SSO and receive JWT.
- **Users** (`/users`)
  - `GET /users`: List users with filtering by department and role.
  - `PATCH /users/:id`: Update user role or department.
  - `POST /users/search-external`: Search external enterprise employees.
- **Departments** (`/departments`)
  - `GET /departments`: Retrieve department tree and members.
  - `POST /departments`: Create a new organizational department.
- **Categories** (`/categories`)
  - `GET /categories/tree`: Retrieve full hierarchical category tree.
  - `POST /categories/semantic-route`: Identify best matching category using vector search.
  - `POST /categories/sync-vectors`: Batch sync vector embeddings (Super Admin).
- **Datasets** (`/datasets`)
  - `GET /datasets`: List datasets with user-specific permissions.
  - `POST /datasets`: Create dataset mirrored in Dify.
  - `POST /datasets/:id/permissions`: Manage department/member access rights.
- **Documents & File Processing** (`/documents`, `/file-processing`)
  - `POST /file-processing/upload`: Upload and enqueue files for conversion & OCR extraction.
  - `GET /file-processing/status/:id`: Check background parsing progress.
- **Chatbot & Conversations** (`/chatbot`)
  - `GET /chatbot/apps`: List chatbots permitted for the authenticated user.
  - `POST /chatbot/chat/stream`: Stream AI responses (SSE) from Dify bots.
  - `POST /chatbot/feedback`: Submit LIKE / DISLIKE ratings on answers.
- **Annotations** (`/annotations`)
  - `POST /annotations`: Draft answer corrections for AI responses.
  - `POST /annotations/:id/publish`: Publish correction to target Dify dataset.

---

## Project Structure

```text
knowledgehub_be/
├── docker-compose.yml          # Multi-container orchestration (API, DB, Redis, Gotenberg)
├── Dockerfile                  # Production container definition
├── package.json                # Dependencies and build scripts
├── tsconfig.json               # TypeScript compiler configuration
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore rules
├── prisma/
│   ├── schema.prisma           # Database schema with pgvector definitions
│   └── migrations/             # SQL schema migrations
├── scripts/
│   └── diagnose-file.ts        # CLI tool for inspecting file byte signatures
├── test_dify_db.js             # Dify DB connectivity & chatbot diagnostic tool
└── src/
    ├── app.module.ts           # Root application module
    ├── main.ts                 # Application entry point & Swagger setup
    ├── common/                 # Shared guards, decorators, interceptors, and filters
    │   ├── decorators/         # @ActiveUser, @Roles
    │   ├── guards/             # AuthGuard, RolesGuard
    │   └── filters/            # Global HttpExceptionFilter
    └── modules/                # Domain feature modules
        ├── auth/               # SSO authentication & JWT handling
        ├── users/              # User management & external search
        ├── departments/        # Organizational departments
        ├── categories/         # Hierarchical tree & semantic routing
        ├── datasets/           # Dify dataset mirroring & permissions
        ├── dataset-members/    # Individual dataset access delegation
        ├── documents/          # Document lifecycle management
        ├── segments/           # Text chunks & Dify segment sync
        ├── dify-client/        # HTTP client for Dify REST API
        ├── chatbot/            # Bot discovery, streaming chat, and annotations
        ├── file-processing/    # Background file parsing (OCR / Gotenberg)
        ├── pg-boss/            # Asynchronous job queue service
        ├── prisma/             # Prisma client service
        └── redis/              # Redis caching service
```

---

## Diagnostic Scripts

### 1. Dify DB & Chatbot Diagnostics
Diagnose dataset linkage, chatbot app discovery, and conversation synchronization:
```bash
node test_dify_db.js
```

### 2. File Type Signature Diagnostic
Inspect unknown file formats via magic byte signatures:
```bash
npx tsx scripts/diagnose-file.ts <path-to-file>
```

---

## License

This project is proprietary and confidential. Unauthorized copying, distribution, or modification is strictly prohibited.
