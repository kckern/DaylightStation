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
    const trimmed = breadcrumbs.slice(0, -1);
    if (trimmed.length === 0) {
      setBreadcrumbs([]);
      setBrowseResults([]);
      return;
    }
    const parent = trimmed[trimmed.length - 1];
    setBreadcrumbs(trimmed.slice(0, -1)); // browse() will re-add the parent
    browse(parent.source, parent.localId, parent.title);
  }, [breadcrumbs, browse]);

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
