import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import { browserPreference } from '@/lib/browserPreference.js';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";

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
 *   setUsername: (username: string|null) => void, loading: boolean, error: string|null }}
 */
export function useLifeUser() {
  const [selected, setSelected] = useState(memberPreference.read);
  const [users, setUsers] = useState([]);
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

  // Load the household roster once for the switcher.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await DaylightAPI('api/v1/life/users');
        if (!cancelled) {
          const list = Array.isArray(json.users) ? json.users : [];
          setUsers(list);
          logger().debug('life.users.loaded', { count: list.length });
        }
      } catch (err) {
        if (!cancelled) logger().warn('life.users.error', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist + apply a new user selection; the resolve effect refetches /user.
  const setUsername = useCallback((username) => {
    if (username) memberPreference.write(username);
    else memberPreference.clear();
    setSelected(username || null);
    logger().info('life.user.switched', { username });
  }, []);

  return { user, users, setUsername, loading: identity.loading, error, retry: identity.reload };
}
