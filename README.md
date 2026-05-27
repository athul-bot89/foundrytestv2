# Agent Chat

A full-stack chat application that connects to an Azure AI Foundry agent. Users authenticate via Microsoft Entra ID (MSAL popup) and chat with the agent in real-time via SSE streaming.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Container                       │
│                                                         │
│  ┌──────────────────┐     ┌──────────────────────────┐  │
│  │  React Frontend  │────▶│   Flask Backend (Gunicorn)│  │
│  │  (Static Build)  │     │   Port 3000              │  │
│  └──────────────────┘     └──────────┬───────────────┘  │
│                                      │                  │
└──────────────────────────────────────┼──────────────────┘
                                       │
                              ┌─────────▼──────────┐
                              │  Azure AI Foundry   │
                              │  (Agent endpoint)   │
                              └────────────────────┘
```

**Frontend** (`chat-app/`): React + Vite SPA with MSAL authentication. Handles user login via a popup window and renders streaming markdown responses with citation support.

**Backend** (`pythonbackend/`): Flask API that validates JWT tokens from Entra ID, then proxies chat requests to an Azure AI Foundry agent. Supports both standard and SSE streaming responses.

**Auth flow**: User clicks "Sign in with Microsoft" → MSAL popup authenticates with Entra ID → Access token passed to backend on every API call → Backend validates JWT signature against Microsoft JWKS endpoint.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- An [Azure AI Foundry](https://ai.azure.com) project with a deployed agent
- An Azure Entra ID **App Registration** (for user authentication)
- An Azure Entra ID **Service Principal** (for backend → Foundry access)

## Environment Variables

### Backend (`pythonbackend/.env`)

| Variable | Description |
|----------|-------------|
| `AZURE_TENANT_ID` | Your Entra ID tenant ID |
| `AZURE_CLIENT_ID` | Service principal client ID (backend credential) |
| `AZURE_CLIENT_SECRET` | Service principal secret |
| `AZURE_ENDPOINT` | Foundry project endpoint (e.g. `https://your-project.services.ai.azure.com`) |
| `AGENT_NAME` | Name of the deployed Foundry agent |
| `AGENT_VERSION` | Version of the deployed agent |

### Frontend (`chat-app/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_CLIENT_ID` | App Registration client ID (for MSAL user auth) |
| `VITE_TENANT_ID` | Your Entra ID tenant ID |

> **Important**: Also update `chat-app/public/auth-config.js` with the same `clientId` and `tenantId` values. This static file is used by the MSAL popup and is not processed by Vite.

## Running with Docker

### Build the image

```bash
docker build \
  --build-arg VITE_CLIENT_ID=your-app-registration-client-id \
  --build-arg VITE_TENANT_ID=your-tenant-id \
  -t agent-chat .
```

### Run the container

```bash
docker run -p 3000:3000 \
  -e AZURE_TENANT_ID=your-tenant-id \
  -e AZURE_CLIENT_ID=your-service-principal-client-id \
  -e AZURE_CLIENT_SECRET=your-service-principal-secret \
  -e AZURE_ENDPOINT=https://your-project.services.ai.azure.com \
  -e AGENT_NAME=your-agent-name \
  -e AGENT_VERSION=your-agent-version \
  agent-chat
```

The app is now running at **http://localhost:3000**.

### Using an env file

Create a `.env` file at the project root with all backend variables, then:

```bash
docker run -p 3000:3000 --env-file .env agent-chat
```

## Local Development

### Backend

```bash
cd pythonbackend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Fill in your values
python app.py
```

Backend runs at `http://localhost:3000`.

### Frontend

```bash
cd chat-app
npm install
cp .env.example .env  # Fill in your values
npm run dev
```

Frontend runs at `https://localhost:5173` with the Vite dev server proxying `/api` requests to the backend.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/chat` | Send messages, get full response |
| POST | `/api/chat/stream` | Send messages, get SSE streaming response |
| GET | `/*` | Serves React SPA |

All `/api/*` endpoints require a valid `Authorization: Bearer <token>` header.

## Project Structure

```
├── Dockerfile              # Multi-stage build (Node → Python)
├── .dockerignore
├── .gitignore
├── README.md
├── chat-app/               # React frontend
│   ├── public/
│   │   ├── auth.html       # MSAL popup login page
│   │   └── auth-config.js  # MSAL config (update with your IDs)
│   ├── src/
│   │   ├── App.jsx         # Auth wrapper + login screen
│   │   ├── Chat.jsx        # Chat UI with streaming & citations
│   │   └── api.js          # API client (fetch + SSE)
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
└── pythonbackend/           # Flask backend
    ├── app.py              # Main app with chat endpoints
    ├── auth.py             # JWT validation middleware
    ├── requirements.txt
    └── .env.example
```
