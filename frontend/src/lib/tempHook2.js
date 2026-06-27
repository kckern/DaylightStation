import { useState, useEffect } from 'react';
import { DaylightAPI } from './api.mjs';

export function useTempHook2(courseId, userId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!courseId);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!courseId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = userId
      ? `api/v1/piano/courses/${courseId}/playable?userId=${encodeURIComponent(userId)}`
      : `api/v1/fitness/show/${courseId}/playable`;

    DaylightAPI(url)
      .then((r) => {
        if (cancelled) return;
        setData(r || { items: [] });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [courseId, userId]);

  return { data, loading, error, items: data?.items ?? null, info: data?.info ?? {}, parents: data?.parents ?? null, isSequential: data?.isSequential ?? false };
}
