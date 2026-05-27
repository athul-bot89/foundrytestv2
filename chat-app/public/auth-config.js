// This file is overwritten at container startup by entrypoint.sh
// using runtime environment variables (CLIENT_ID, TENANT_ID).
// For local dev, set the values below directly.
window.__AUTH_CONFIG__ = {
  clientId: "YOUR_APP_REGISTRATION_CLIENT_ID",
  tenantId: "YOUR_TENANT_ID",
  scopes: ["https://ai.azure.com/.default"]
};
