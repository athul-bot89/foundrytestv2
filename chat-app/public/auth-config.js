// This file is overwritten at container startup by entrypoint.sh
// using runtime environment variables (CLIENT_ID, TENANT_ID).
// For local dev, set the values below directly.
window.__AUTH_CONFIG__ = {
  clientId: "a6a12b3f-5140-47c6-ac41-fa3d14080885",
  tenantId: "b678434e-f26d-4d7f-947b-204156adc399",
  scopes: ["https://ai.azure.com/.default"]
};
