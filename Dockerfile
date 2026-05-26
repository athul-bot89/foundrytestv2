# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build

WORKDIR /app/chat-app
COPY chat-app/package.json chat-app/package-lock.json* ./
RUN npm install
COPY chat-app/ ./

ARG REACT_APP_AZURE_CLIENT_ID
ARG REACT_APP_AZURE_TENANT_ID
ENV REACT_APP_AZURE_CLIENT_ID=$REACT_APP_AZURE_CLIENT_ID
ENV REACT_APP_AZURE_TENANT_ID=$REACT_APP_AZURE_TENANT_ID

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
COPY --from=frontend-build /app/chat-app/build /app/static-build

# Set environment variable for static build path
ENV STATIC_BUILD_DIR=/app/static-build

EXPOSE 3000

CMD ["gunicorn", "--bind", "0.0.0.0:3000", "--worker-class", "gevent", "--workers", "4", "--timeout", "120", "app:app"]
