const clientId = process.env.REACT_APP_AZURE_CLIENT_ID;
const tenantId = process.env.REACT_APP_AZURE_TENANT_ID;

export const msalConfig = {
  auth: {
    clientId: clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ["openid", "profile", "User.Read"],
};
