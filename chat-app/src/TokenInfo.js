import React, { useState, useEffect } from "react";

// Allowed parent origins that can send tokens via postMessage
const ALLOWED_ORIGINS = [
  "https://yourtenant.sharepoint.com",       // Replace with your SharePoint tenant
  "https://yourtenant-admin.sharepoint.com",
];

function TokenInfo() {
  const [token, setToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    function handleMessage(event) {
      // Validate origin
      if (!ALLOWED_ORIGINS.some((o) => event.origin.startsWith(o))) return;
      if (event.data && event.data.type === "AUTH_TOKEN") {
        setToken(event.data.token);
        setUserInfo(event.data.user || null);
        setWaiting(false);
      }
    }

    window.addEventListener("message", handleMessage);

    // Ask parent for token on load
    if (window.parent !== window) {
      window.parent.postMessage({ type: "REQUEST_TOKEN" }, "*");
    }

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (waiting) {
    return <div className="token-info">Waiting for token from SharePoint...</div>;
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
