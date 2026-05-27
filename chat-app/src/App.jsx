import { useEffect, useState, useCallback } from "react";
import Chat from "./Chat";
import "./App.css";

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
        <Chat token={token} email={email} onSignOut={handleSignOut} />
      </div>
    );
  }

  return (
    <div className="App">
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <h2>Agent Chat</h2>
          <p>Sign in with your organization account to continue.</p>
          <button className="ms-login-btn" onClick={connect}>
            <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
