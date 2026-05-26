import React, { useState, useEffect, useCallback } from "react";

// Allowed parent origins that can send tokens via postMessage
const ALLOWED_ORIGINS = [
  "https://botangelos.sharepoint.com",
  "http://localhost:3000",  // LOCAL DEV ONLY — remove before production
];

function TokenInfo() {
  const [token, setToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [waiting, setWaiting] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  const handleCopy = useCallback(() => {
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [token]);

  if (waiting) {
    return (
      <div className="token-info token-waiting">
        <div className="token-spinner" />
        <span>Waiting for token from SharePoint...</span>
      </div>
    );
  }

  return (
    <div className="token-info">
      {userInfo && (
        <div className="token-details">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12Z"/>
            <path d="M12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z"/>
          </svg>
          <strong>{userInfo.name}</strong>
          <span className="token-email">{userInfo.email}</span>
        </div>
      )}
      {token && (
        <div className="token-section">
          <div className="token-header">
            <strong>Bearer Token</strong>
            <div className="token-actions">
              <button
                className="token-toggle-btn"
                onClick={() => setExpanded(!expanded)}
                title={expanded ? "Collapse token" : "Expand token"}
              >
                {expanded ? "Hide" : "Show"}
              </button>
              <button
                className="token-copy-btn"
                onClick={handleCopy}
                title="Copy token to clipboard"
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>
          <div className={`token-value ${expanded ? "expanded" : ""}`}>
            <code>{expanded ? token : `${token.slice(0, 40)}...${token.slice(-10)}`}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default TokenInfo;
