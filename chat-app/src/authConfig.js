import { PublicClientApplication, LogLevel } from "@azure/msal-browser";

let msalInstance = null;
let tokenRequest = null;

export async function initializeMsal() {
  const res = await fetch("/api/config");
  const config = await res.json();

  const msalConfig = {
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: true,
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
      },
      allowRedirectInIframe: true,
    },
  };

  msalInstance = new PublicClientApplication(msalConfig);
  await msalInstance.initialize();

  tokenRequest = {
    scopes: [config.tokenScope || "https://cognitiveservices.azure.com/.default"],
  };

  return msalInstance;
}

export { msalInstance, tokenRequest };
