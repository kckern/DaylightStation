import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

export function useContentInfo(contentId) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(typeof contentId === 'string' && contentId.includes(':'));
  const [error, setError] = useState(null);

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
        setError(err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [contentId]);

  return { info, loading, error };
}

export default useContentInfo;
