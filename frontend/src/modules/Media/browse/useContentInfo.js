import { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { mediaLog } from '../logging/mediaLog.js';

export function useContentInfo(contentId) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(typeof contentId === 'string' && contentId.includes(':'));
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (typeof contentId !== 'string' || !contentId.includes(':')) {
      setInfo(null);
      setLoading(false);
      setError(null);
      return;
    }
    const idx = contentId.indexOf(':');
    const source = contentId.slice(0, idx);
    const localId = contentId.slice(idx + 1);
    const url = `api/v1/info/${source}/${localId}`;
    setLoading(true);
    setError(null);
    let cancelled = false;
    DaylightAPI(url)
      .then((res) => {
        if (cancelled) return;
        setInfo(res ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        mediaLog.loadFailed({ surface: 'detail', contentId, error: err?.message });
        setError(err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [contentId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { info, loading, error, reload };
}

export default useContentInfo;
