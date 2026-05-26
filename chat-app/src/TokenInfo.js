import React, { useState, useEffect } from "react";
import { msalInstance, tokenRequest } from "./authConfig";

function TokenInfo() {
  const [token, setToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function acquireToken() {
      try {
        // Try ssoSilent first — reuses the existing Azure AD session (SharePoint login)
        const ssoResponse = await msalInstance.ssoSilent(tokenRequest);
        setToken(ssoResponse.accessToken);
        setUserInfo({
          name: ssoResponse.account.name,
          email: ssoResponse.account.username,
        });
      } catch (ssoError) {
        // ssoSilent failed — try acquireTokenSilent with any cached account
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          try {
            const silentResponse = await msalInstance.acquireTokenSilent({
              ...tokenRequest,
              account: accounts[0],
            });
            setToken(silentResponse.accessToken);
            setUserInfo({
              name: silentResponse.account.name,
              email: silentResponse.account.username,
            });
          } catch (silentError) {
            setError("Silent token acquisition failed: " + silentError.message);
          }
        } else {
          setError("No active session found. SSO failed: " + ssoError.message);
        }
      } finally {
        setLoading(false);
      }
    }

    acquireToken();
  }, []);

  if (loading) {
    return <div className="token-info">Acquiring token silently via MSAL...</div>;
  }

  if (error) {
    return <div className="token-info token-error">{error}</div>;
  }

  return (
    <div className="token-info">
      {userInfo && (
        <div className="token-details">
          <strong>User:</strong> {userInfo.name} ({userInfo.email})
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
