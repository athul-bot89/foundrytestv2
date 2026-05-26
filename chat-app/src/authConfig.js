import { PublicClientApplication, LogLevel } from "@azure/msal-browser";

const msalConfig = {
  auth: {
    clientId: "YOUR_APP_CLIENT_ID",           // Replace with your Azure AD app registration client ID
    authority: "https://login.microsoftonline.com/YOUR_TENANT_ID", // Replace with your tenant ID
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: true,              // Helps with IE11/Edge issues in iframes
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
    },
    allowRedirectInIframe: true,               // Required when embedded in SharePoint iframe
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

// Scope for Azure AI Foundry / Cognitive Services
export const tokenRequest = {
  scopes: ["https://cognitiveservices.azure.com/.default"],
};
