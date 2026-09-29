// frontend/src/modules/Media/identity/ClientIdentityProvider.jsx
// Stable per-browser identity: clientId (UUID, persisted) + display name.
// Logs, broadcasts, and external control address this browser by these.
import React, { createContext, useCallback, useMemo, useState } from 'react';
import { useControlRegistration } from '../externalControl/useControlRegistration.js';
import { createBrowserIdentity, renameBrowserIdentity } from './browserIdentity.js';

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
  const [identity, setIdentity] = useState(() => createBrowserIdentity({ randomUuid: uuidV4 }));
  const registration = useControlRegistration(identity.clientId);
  const rename = useCallback((input) => {
    setIdentity(current => renameBrowserIdentity(current, { ...input, storage: localStorage }));
  }, []);
  const value = useMemo(() => ({
    ...identity,
    displayName: identity.name,
    controlClientId: identity.clientId,
    controlReady: registration.ready,
    rename,
  }), [identity, registration.ready, rename]);

  return (
    <ClientIdentityContext.Provider value={value}>
      {children}
    </ClientIdentityContext.Provider>
  );
}

export default ClientIdentityProvider;
