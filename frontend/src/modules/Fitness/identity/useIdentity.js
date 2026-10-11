// useIdentity.js — the consumer hook for IdentityProvider.jsx, split out so
// Fast Refresh can hot-reload files that only export components.
import { useContext } from 'react';
import { IdentityContext } from './IdentityProvider.jsx';

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used within an IdentityProvider');
  return ctx;
}

/** Same context, or null outside an IdentityProvider — for surfaces that may render without one. */
export function useOptionalIdentity() {
  return useContext(IdentityContext);
}
