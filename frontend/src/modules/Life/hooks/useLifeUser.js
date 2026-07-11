import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLifeUser' });
  return _logger;
}

/** localStorage key holding the manually-selected household username. */
const STORAGE_KEY = 'life.username';

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

/** Read the stored username selection, tolerating environments without localStorage. */
function readStoredUsername() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
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
  const [selected, setSelected] = useState(readStoredUsername);
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Resolve the active user, re-running when the selection changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = selected ? `?username=${encodeURIComponent(selected)}` : '';
        const res = await fetch(`/api/v1/life/user${qs}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setUser(json);
          logger().info('life.user.resolved', { username: json.username, selected: !!selected });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          logger().warn('life.user.error', { error: err.message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  // Load the household roster once for the switcher.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/life/users');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
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
    try {
      if (typeof localStorage !== 'undefined') {
        if (username) localStorage.setItem(STORAGE_KEY, username);
        else localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage unavailable (private mode, etc.) — selection still applies for the session.
    }
    setSelected(username || null);
    logger().info('life.user.switched', { username });
  }, []);

  return { user, users, setUsername, loading, error };
}
