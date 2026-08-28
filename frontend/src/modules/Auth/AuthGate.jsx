// frontend/src/modules/Auth/AuthGate.jsx
import { useState, useCallback } from 'react';
import { getUser } from '../../lib/auth.js';
import LoginScreen from './LoginScreen.jsx';

// `app` is accepted (see callers like <AuthGate app="admin">) for the future
// per-app role expansion described below, but isn't consulted yet.
export default function AuthGate({ app: _app, children }) {
  const [, setRefresh] = useState(0);

  const handleLogin = useCallback(() => {
    setRefresh(n => n + 1);
  }, []);

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalhost) return children;

  const user = getUser();
  // Full role->app expansion would need auth config from backend.
  // For now, any authenticated user with a token passes the gate.
  // The backend permissionGate is the real enforcer.

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return children;
}
