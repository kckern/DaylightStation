import { useEffect, useState } from 'react';
import { titleCache } from '../utils/titleCache.js';

/**
 * Resolve the human-readable title of a "source:id" content ID, sharing the
 * module-level `titleCache` with LabeledContentPicker so summary rows and
 * pickers never refetch the same id. Fail-soft: returns null on any error.
 */
export function useContentTitle(contentId) {
  const [title, setTitle] = useState(
    () => (contentId ? titleCache.get(contentId) || null : null)
  );

  useEffect(() => {
    if (!contentId) {
      setTitle(null);
      return;
    }
    const cached = titleCache.get(contentId);
    if (cached) {
      setTitle(cached);
      return;
    }
    const [source, id] = contentId.split(':');
    if (!source || !id) return;
    let cancelled = false;
    fetch(`/api/v1/info/${encodeURIComponent(source)}/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const t = data?.title ?? null;
        if (t) titleCache.set(contentId, t);
        setTitle(t);
      })
      .catch(() => { /* fail-soft */ });
    return () => { cancelled = true; };
  }, [contentId]);

  return title;
}

export default useContentTitle;
