import React from "react";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { loginRequest } from "./authConfig";
import Chat from "./Chat";

function AuthGate() {
  const isAuthenticated = useIsAuthenticated();
  const { instance, inProgress } = useMsal();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch((e) => {
      console.error("Login failed:", e);
    });
  };

  if (inProgress !== "none") {
    return (
      <div className="auth-loading">
        <p>Authenticating...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor"/>
            </svg>
          </div>
          <h2>Agent Chat</h2>
          <p>Sign in with your organization account to continue.</p>
          <button className="ms-login-btn" onClick={handleLogin}>
            <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    );
  }

  return <Chat />;
}

export default AuthGate;
