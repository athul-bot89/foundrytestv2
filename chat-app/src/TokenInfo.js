import React, { useState, useEffect } from "react";
import { msalInstance, tokenRequest } from "./authConfig";

const isEmbeddedInIframe = window.parent !== window;

function TokenInfo() {
  const [token, setToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isEmbeddedInIframe) {
      // --- IFRAME MODE: receive token from SPFx web part via postMessage ---
      function handleMessage(event) {
        console.log("[TokenInfo] postMessage received:", event.origin, event.data?.type);
        if (event.data && event.data.type === "AUTH_TOKEN") {
          console.log("[TokenInfo] Token received from:", event.origin);
          setToken(event.data.token);
          setUserInfo(event.data.user || null);
          setLoading(false);
        }
      }
      window.addEventListener("message", handleMessage);
      // Ask parent for token
      console.log("[TokenInfo] Requesting token from parent frame...");
      window.parent.postMessage({ type: "REQUEST_TOKEN" }, "*");

      // Timeout after 5s if no response
      const timeout = setTimeout(() => {
        console.error("[TokenInfo] Timeout - no AUTH_TOKEN received in 5s");
        setError("No token received from SharePoint host.");
        setLoading(false);
      }, 5000);

      return () => {
        window.removeEventListener("message", handleMessage);
        clearTimeout(timeout);
      };
    } else {
      // --- STANDALONE MODE: use MSAL.js (dev/testing outside SharePoint) ---
      async function acquireToken() {
        try {
          const ssoResponse = await msalInstance.ssoSilent(tokenRequest);
          setToken(ssoResponse.accessToken);
          setUserInfo({
            name: ssoResponse.account.name,
            email: ssoResponse.account.username,
          });
        } catch (ssoError) {
          // ssoSilent failed — try acquireTokenSilent with cached account
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
              // Fall back to popup login
              try {
                const popupResponse = await msalInstance.acquireTokenPopup(tokenRequest);
                setToken(popupResponse.accessToken);
                setUserInfo({
                  name: popupResponse.account.name,
                  email: popupResponse.account.username,
                });
              } catch (popupError) {
                setError("Login failed: " + popupError.message);
              }
            }
          } else {
            // No cached account — trigger popup login
            try {
              const popupResponse = await msalInstance.acquireTokenPopup(tokenRequest);
              setToken(popupResponse.accessToken);
              setUserInfo({
                name: popupResponse.account.name,
                email: popupResponse.account.username,
              });
            } catch (popupError) {
              setError("Login failed: " + popupError.message);
            }
          }
        } finally {
          setLoading(false);
        }
      }
      acquireToken();
    }
  }, []);

  if (loading) {
    return (
      <div className="token-info">
        {isEmbeddedInIframe
          ? "Waiting for token from SharePoint..."
          : "Acquiring token via MSAL..."}
      </div>
    );
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
