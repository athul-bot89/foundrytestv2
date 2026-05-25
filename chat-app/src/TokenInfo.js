import React, { useState, useEffect } from "react";
import { PublicClientApplication } from "@azure/msal-browser";

const CLIENT_ID = "YOUR_AAD_APP_CLIENT_ID"; // Replace with your App Registration client ID
const TENANT_ID = "YOUR_TENANT_ID"; // Replace with your Azure AD tenant ID
const SCOPES = ["User.Read"];

const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin,
  },
};

const msalInstance = new PublicClientApplication(msalConfig);

function TokenInfo() {
  const [token, setToken] = useState(null);
  const [accountInfo, setAccountInfo] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function acquireToken() {
      try {
        await msalInstance.initialize();
        const resp = await msalInstance.handleRedirectPromise();

        if (resp) {
          setToken(resp.accessToken);
          setAccountInfo(resp.account);
          setLoading(false);
          return;
        }

        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          try {
            const silentResp = await msalInstance.acquireTokenSilent({
              scopes: SCOPES,
              account: accounts[0],
            });
            setToken(silentResp.accessToken);
            setAccountInfo(silentResp.account);
          } catch {
            await msalInstance.acquireTokenRedirect({ scopes: SCOPES });
          }
        } else {
          await msalInstance.loginRedirect({ scopes: SCOPES });
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    acquireToken();
  }, []);

  if (loading) {
    return <div className="token-info">Acquiring token...</div>;
  }

  if (error) {
    return <div className="token-info token-error">Error: {error}</div>;
  }

  return (
    <div className="token-info">
      {accountInfo && (
        <div className="token-details">
          <strong>User:</strong> {accountInfo.name} ({accountInfo.username})
          <br />
          <strong>Tenant:</strong> {accountInfo.tenantId}
        </div>
      )}
      {token && (
        <div className="token-value">
          <strong>Token:</strong>
          <code>{token.slice(0, 40)}...{token.slice(-10)}</code>
        </div>
      )}
    </div>
  );
}

export default TokenInfo;
