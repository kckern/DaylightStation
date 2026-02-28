// frontend/src/hooks/media/useContentBrowse.js
import { useState, useCallback } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useContentBrowse' });
  return _logger;
}

export function useContentBrowse() {
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [browseResults, setBrowseResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (source, localId, title) => {
    setLoading(true);
    logger().debug('browse.start', { source, localId, title });
    try {
      const res = await fetch(`/api/v1/list/${source}/${localId}`);
      if (!res.ok) throw new Error(`Browse failed: ${res.status}`);
      const data = await res.json();
      const items = data.items || data.children || [];
      logger().info('browse.loaded', { source, localId, resultCount: items.length });
      setBrowseResults(items);
      setBreadcrumbs(prev => [...prev, { source, localId, title }]);
    } catch (err) {
      logger().warn('browse.failed', { source, localId, error: err.message });
      setBrowseResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const goBack = useCallback(() => {
    logger().debug('browse.back', { depth: breadcrumbs.length });
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
    if (breadcrumbs.length > 0) logger().debug('browse.exit');
    setBreadcrumbs([]);
    setBrowseResults([]);
  }, [breadcrumbs]);

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
