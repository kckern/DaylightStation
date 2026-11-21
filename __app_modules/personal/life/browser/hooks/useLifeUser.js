import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import { browserPreference } from '@/lib/browserPreference.js';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

const EMPTY_USERS = [];

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLifeUser' });
  return _logger;
}

/** localStorage key holding the manually-selected household username. */
const memberPreference = browserPreference('life.username', null, username => username || null);

/**
 * Context carrying the backend-resolved life user ({ username, displayName }).
 * Provided by LifeApp; consumed by views/hooks that need a username without
 * each fetching /life/user themselves.
 */
export const LifeUserContext = createContext(null);

/** Resolved user from the nearest provider, or null outside one / before load. */
export function useLifeUsername() {
  return useContext(LifeUserContext)?.username || null;
}

/**
 * Resolve the current life user + the household roster for the switcher.
 *
 * Resolution honors an explicit `localStorage['life.username']` selection so a
 * household member on the shared tablet can act as themselves; absent a
 * selection the backend resolves head-of-household. Used once at the LifeApp
 * root: `user` feeds LifeUserContext, `users` + `setUsername` drive the header
 * Select.
 *
 * @returns {{ user: object|null, users: Array<{username,displayName}>,
 *   setUsername: (username: string|null) => void, loading: boolean, error: string|null,
 *   rosterError: Error|null, rosterLoading: boolean, rosterRetrying: boolean,
 *   retryRoster: () => Promise<void> }}
 */
export function useLifeUser() {
  const [selected, setSelected] = useState(memberPreference.read);
  const [rosterRetrying, setRosterRetrying] = useState(false);
  const roster = useApiResource('api/v1/life/users', { label: 'Life household roster', logger: logger() });
  const users = Array.isArray(roster.data?.users) ? roster.data.users : EMPTY_USERS;
  const qs = selected ? `?username=${encodeURIComponent(selected)}` : '';
  const identity = useApiResource(`api/v1/life/user${qs}`, { label: 'Life household member', logger: logger() });
  const resolved = identity.data;
  const matches = typeof resolved?.username === 'string' && !!resolved.username && (!selected || resolved.username === selected);
  const user = matches ? resolved : null;
  const error = identity.error?.message || (!identity.loading && !user ? 'Could not resolve the selected household member.' : null);

  useEffect(() => {
    if (user) logger().info('life.user.resolved', { username: user.username, selected: !!selected });
    else if (error) logger().warn('life.user.error', { error });
  }, [user, error, selected]);

  useEffect(() => {
    if (roster.error) logger().warn('life.users.error', { error: roster.error.message });
    else if (roster.data) logger().debug('life.users.loaded', { count: users.length });
  }, [roster.data, roster.error, users.length]);

  // Persist + apply a new user selection; the resolve effect refetches /user.
  const setUsername = useCallback((username) => {
    if (username) memberPreference.write(username);
    else memberPreference.clear();
    setSelected(username || null);
    logger().info('life.user.switched', { username });
  }, []);

  const retryRoster = useCallback(async () => {
    setRosterRetrying(true);
    try { await roster.refresh(); }
    catch { /* The resource exposes the read error to the header. */ }
    finally { setRosterRetrying(false); }
  }, [roster.refresh]);

  return {
    user, users, setUsername, loading: identity.loading, error, retry: identity.reload,
    rosterError: roster.error, rosterLoading: roster.loading, rosterRetrying, retryRoster,
  };
}
