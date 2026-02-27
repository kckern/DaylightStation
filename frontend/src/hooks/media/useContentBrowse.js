// frontend/src/hooks/media/useContentBrowse.js
import { useState, useCallback } from 'react';

export function useContentBrowse() {
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [browseResults, setBrowseResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (source, localId, title) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/list/${source}/${localId}`);
      if (!res.ok) throw new Error(`Browse failed: ${res.status}`);
      const data = await res.json();
      setBrowseResults(data.items || data.children || []);
      setBreadcrumbs(prev => [...prev, { source, localId, title }]);
    } catch (err) {
      setBrowseResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const goBack = useCallback(() => {
    setBreadcrumbs(prev => {
      const next = prev.slice(0, -1);
      if (next.length === 0) {
        setBrowseResults([]);
        return [];
      }
      const last = next[next.length - 1];
      browse(last.source, last.localId, last.title);
      return next.slice(0, -1); // browse will re-push
    });
  }, [browse]);

  const exitBrowse = useCallback(() => {
    setBreadcrumbs([]);
    setBrowseResults([]);
  }, []);

  return {
    breadcrumbs,
    browseResults,
    browsing: breadcrumbs.length > 0,
    loading,
    browse,
    goBack,
    exitBrowse,
  };
}
