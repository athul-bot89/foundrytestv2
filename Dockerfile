# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build

WORKDIR /app/chat-app
COPY chat-app/package.json chat-app/package-lock.json* ./
RUN npm install
COPY chat-app/ ./
RUN npm run build

# Stage 2: Production image with Flask backend
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies
COPY pythonbackend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY pythonbackend/ ./

# Copy React build from stage 1
COPY --from=frontend-build /app/chat-app/dist /app/static-build

# Copy entrypoint script (generates auth-config.js at runtime from env vars)
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Set environment variable for static build path
ENV STATIC_BUILD_DIR=/app/static-build
ENV PYTHONUNBUFFERED=1

EXPOSE 3000

# All config is injected at runtime via environment variables:
#   CLIENT_ID       - Azure Entra App Registration client ID
#   TENANT_ID       - Azure Entra tenant ID
#   AZURE_ENDPOINT  - Azure AI project endpoint
#   AGENT_NAME      - Agent name
#   AGENT_VERSION   - Agent version
#   APPLICATIONINSIGHTS_CONNECTION_STRING - Application Insights connection string
ENTRYPOINT ["./entrypoint.sh"]
