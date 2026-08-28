// useClientIdentity.js — consumer hook for ClientIdentityProvider.jsx's
// context, split out so Fast Refresh can hot-reload the provider on its own.
import { useContext } from 'react';
import { ClientIdentityContext } from './ClientIdentityProvider.jsx';

export function useClientIdentity() {
  const ctx = useContext(ClientIdentityContext);
  if (!ctx) throw new Error('useClientIdentity must be used within ClientIdentityProvider');
  return ctx;
}
