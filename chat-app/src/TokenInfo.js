import React, { useState } from "react";
import { msalInstance, tokenRequest } from "./authConfig";

function TokenInfo() {
  const [token, setToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const response = await msalInstance.loginPopup(tokenRequest);
      setToken(response.accessToken);
      setUserInfo({
        name: response.account.name,
        email: response.account.username,
      });
    } catch (err) {
      setError("Login failed: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    msalInstance.logoutPopup();
    setToken(null);
    setUserInfo(null);
  }

  if (error) {
    return (
      <div className="token-info token-error">
        {error}
        <button onClick={handleLogin} style={{ marginLeft: 12 }}>Retry</button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="token-info">
        <button onClick={handleLogin} disabled={loading}>
          {loading ? "Signing in..." : "Sign in with Microsoft"}
        </button>
      </div>
    );
  }

  return (
    <div className="token-info">
      {userInfo && (
        <div className="token-details">
          <strong>User:</strong> {userInfo.name} ({userInfo.email})
          <button onClick={handleLogout} style={{ marginLeft: 12 }}>Sign out</button>
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
