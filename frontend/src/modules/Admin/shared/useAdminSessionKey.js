import { useSyncExternalStore } from 'react';
import { getToken, getUser, subscribeToken } from '../../../lib/auth.js';

/** Stable identity for scoping Admin-only in-memory state to an auth session. */
export function getAdminSessionKey() {
  try {
    const token = getToken();
    if (!token) return 'anonymous';
    const user = getUser();
    if (!user) return token;
    return JSON.stringify([user.sub ?? null, user.sid ?? user.iat ?? token]);
  } catch {
    return 'anonymous';
  }
}

/** Reactive session identity for Admin views that retain client-side state. */
export function useAdminSessionKey() {
  return useSyncExternalStore(subscribeToken, getAdminSessionKey, () => 'anonymous');
}
