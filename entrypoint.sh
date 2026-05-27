#!/bin/sh
set -e

# Generate auth-config.js from runtime environment variables
cat > /app/static-build/auth-config.js <<EOF
window.__AUTH_CONFIG__ = {
  clientId: "${CLIENT_ID:-}",
  tenantId: "${TENANT_ID:-}",
  scopes: ["https://ai.azure.com/.default"]
};
EOF

echo "Generated auth-config.js with CLIENT_ID=${CLIENT_ID:+set} TENANT_ID=${TENANT_ID:+set}"

# Start gunicorn
exec gunicorn --bind 0.0.0.0:3000 --worker-class gevent --workers 4 --timeout 120 app:app
