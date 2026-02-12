// frontend/src/modules/Auth/AuthGate.jsx
import { useState, useCallback } from 'react';
import { getUser } from '../../lib/auth.js';
import LoginScreen from './LoginScreen.jsx';

export default function AuthGate({ app, children }) {
  const [, setRefresh] = useState(0);

  const user = getUser();
  const hasAccess = user && (
    (user.roles || []).some(r => r === 'sysadmin') ||
    app === undefined
    // Full role->app expansion would need auth config from backend.
    // For now, any authenticated user with a token passes the gate.
    // The backend permissionGate is the real enforcer.
  );

  const handleLogin = useCallback(() => {
    setRefresh(n => n + 1);
  }, []);

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return children;
}
