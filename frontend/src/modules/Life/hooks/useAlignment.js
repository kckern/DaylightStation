import { useState, useEffect, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { useLifeUsername } from './useLifeUser.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useAlignment' });
  return _logger;
}

export function useAlignment(mode = 'priorities', username) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Follow the selected household user (explicit arg wins over context).
  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const userQs = user ? `&username=${encodeURIComponent(user)}` : '';
      const res = await fetch(`/api/v1/life/now?mode=${mode}${userQs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      logger().debug('life.alignment.fetched', { mode, durationMs: Math.round(performance.now() - start) });
    } catch (err) {
      setError(err.message);
      logger().warn('life.alignment.error', { mode, error: err.message, durationMs: Math.round(performance.now() - start) });
    } finally {
      setLoading(false);
    }
  }, [mode, user]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refetch: fetch_ };
}
