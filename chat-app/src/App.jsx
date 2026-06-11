import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import "./App.css";

const Chat = lazy(() => import("./Chat"));

function App() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    function handleMessage(e) {
      // Validate origin to prevent unauthorized messages
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "AUTH") {
        setEmail(e.data.email);
        setToken(e.data.token);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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

  if (token && email) {
    return (
      <div className="App">
        <Suspense fallback={<div className="auth-loading">Loading chat...</div>}>
          <Routes>
            <Route path="/no-citations" element={<Chat token={token} email={email} showCitations={false} />} />
            <Route path="*" element={<Chat token={token} email={email} showCitations={true} />} />
          </Routes>
        </Suspense>
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
