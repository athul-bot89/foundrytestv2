import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import "./App.css";

const Chat = lazy(() => import("./Chat"));

function App() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [idToken, setIdToken] = useState("");
  const [authError, setAuthError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    function handleMessage(e) {
      // Validate origin to prevent unauthorized messages
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "AUTH") {
        setAuthError("");
        // Verify authorization before granting access
        verifyAuthorization(e.data.token, e.data.email, e.data.idToken);
      } else if (e.data?.type === "AUTH_ERROR") {
        setAuthError(e.data.error || "unknown");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function verifyAuthorization(tkn, userEmail, idTkn) {
    setVerifying(true);
    try {
      const headers = { Authorization: `Bearer ${tkn}` };
      if (idTkn) headers["X-ID-Token"] = idTkn;
      const res = await fetch("/api/auth/check", { headers });
      if (res.ok) {
        setEmail(userEmail);
        setToken(tkn);
        setIdToken(idTkn || "");
      } else {
        setAuthError("not_authorized");
      }
    } catch {
      setAuthError("not_authorized");
    } finally {
      setVerifying(false);
    }
  }

  const connect = useCallback(() => {
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(
      window.location.origin + "/auth.html",
      "login",
      `width=${width},height=${height},left=${left},top=${top}`
    );
  }, []);

  const handleSignOut = useCallback(() => {
    setEmail("");
    setToken("");
    // Clear MSAL cache so next login is fresh
    localStorage.clear();
  }, []);

  if (verifying) {
    return (
      <div className="App">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="currentColor" opacity="0.3"/>
              </svg>
            </div>
            <h2>Verifying access...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (token && email) {
    return (
      <div className="App">
        <Suspense fallback={<div className="auth-loading">Loading chat...</div>}>
          <Routes>
            <Route path="/no-citations" element={<Chat token={token} idToken={idToken} email={email} showCitations={false} />} />
            <Route path="*" element={<Chat token={token} idToken={idToken} email={email} showCitations={true} />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  if (authError === "not_authorized") {
    return (
      <div className="App">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-icon" style={{ color: "#d32f2f" }}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm0-4V7h2v6h-2z" fill="currentColor"/>
              </svg>
            </div>
            <h2>Access Denied</h2>
            <p style={{ color: "#666", marginBottom: "16px" }}>
              You are not authorized to use this application.<br />
              Please contact your administrator to request access.
            </p>
            <button className="start-chat-btn" onClick={() => { setAuthError(""); connect(); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 4v10h10M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/>
            </svg>
          </div>
          <h2></h2>
          
          <button className="start-chat-btn" onClick={connect}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            Policy Agent
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
