// frontend/src/modules/Media/identity/ClientIdentityProvider.jsx
// Stable per-browser identity: clientId (UUID, persisted) + display name.
// Logs, broadcasts, and external control address this browser by these.
import React, { createContext, useMemo } from 'react';
import { STORAGE_KEYS } from '../constants.js';

export const ClientIdentityContext = createContext(null);

function uuidV4() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ClientIdentityProvider({ children }) {
  const value = useMemo(() => {
    let clientId = localStorage.getItem(STORAGE_KEYS.CLIENT_ID);
    if (!clientId) {
      clientId = uuidV4();
      try { localStorage.setItem(STORAGE_KEYS.CLIENT_ID, clientId); } catch { /* ignore */ }
    }
    const stored = localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);
    const displayName = stored || `Client ${clientId.slice(0, 8)}`;
    return { clientId, displayName };
  }, []);

  return (
    <ClientIdentityContext.Provider value={value}>
      {children}
    </ClientIdentityContext.Provider>
  );
}

export default ClientIdentityProvider;
