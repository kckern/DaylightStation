import React, { createContext, useContext, useMemo } from 'react';

export const CLIENT_ID_KEY   = 'media-app.client-id';
export const DISPLAY_NAME_KEY = 'media-app.display-name';

const ClientIdentityContext = createContext(null);

function uuidV4() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ClientIdentityProvider({ children }) {
  const value = useMemo(() => {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    if (!clientId) {
      clientId = uuidV4();
      try { localStorage.setItem(CLIENT_ID_KEY, clientId); } catch { /* ignore */ }
    }
    const stored = localStorage.getItem(DISPLAY_NAME_KEY);
    const displayName = stored || `Client ${clientId.slice(0, 8)}`;
    return { clientId, displayName };
  }, []);

  return (
    <ClientIdentityContext.Provider value={value}>
      {children}
    </ClientIdentityContext.Provider>
  );
}

export function useClientIdentity() {
  const ctx = useContext(ClientIdentityContext);
  if (!ctx) throw new Error('useClientIdentity must be used within ClientIdentityProvider');
  return ctx;
}

export default ClientIdentityProvider;
