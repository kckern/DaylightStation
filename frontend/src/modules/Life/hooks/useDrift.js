import { useState, useEffect, useCallback } from 'react';
import { useLifeUsername } from './useLifeUser.js';

export function useDrift(username) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Follow the selected household user (explicit arg wins over context).
  const ctxUsername = useLifeUsername();
  const user = username || ctxUsername;
  const qs = user ? `?username=${encodeURIComponent(user)}` : '';

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/life/now/drift${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/life/now/drift/refresh${qs}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  return { data, loading, error, refetch: fetch_, refresh };
}
