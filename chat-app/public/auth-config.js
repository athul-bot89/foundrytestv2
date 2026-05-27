// Auth configuration for the MSAL popup window.
// These values MUST match your Azure Entra ID App Registration.
// For local dev, also set VITE_CLIENT_ID and VITE_TENANT_ID in chat-app/.env
window.__AUTH_CONFIG__ = {
  clientId: "a6a12b3f-5140-47c6-ac41-fa3d14080885",
  tenantId: "b678434e-f26d-4d7f-947b-204156adc399",
  scopes: ["https://ai.azure.com/.default"]
};
