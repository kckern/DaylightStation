import { useEffect, useState } from 'react';
import LoginScreen from './LoginScreen.jsx';

// Sign in at the requested URL. Reload that URL so the newly signed-in
// service starts with a fresh document and resource cache.
export default function PhoneServiceAuth({ children }) {
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    function requireSignIn() { setNeedsSignIn(true); }
    window.addEventListener('daylight:phone-sign-in-needed', requireSignIn);
    return () => window.removeEventListener('daylight:phone-sign-in-needed', requireSignIn);
  }, []);

  return needsSignIn ? <LoginScreen onLogin={() => window.history.go(0)} /> : children;
}
