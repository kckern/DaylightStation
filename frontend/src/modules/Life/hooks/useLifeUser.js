import { createContext, useContext, useState, useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLifeUser' });
  return _logger;
}

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
 * Fetch the resolved life user from the backend (head of household unless
 * ?username= overrides). Used once at the LifeApp root to feed LifeUserContext.
 */
export function useLifeUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/life/user');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setUser(json);
          logger().info('life.user.resolved', { username: json.username });
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
  }, []);

  return { user, loading, error };
}
