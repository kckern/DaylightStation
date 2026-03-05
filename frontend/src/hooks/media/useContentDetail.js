import { useState, useEffect, useCallback } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useContentDetail' });
  return _logger;
}

function parseContentId(contentId) {
  const colonIdx = contentId.indexOf(':');
  if (colonIdx < 0) return { source: 'plex', localId: contentId };
  return {
    source: contentId.slice(0, colonIdx),
    localId: contentId.slice(colonIdx + 1),
  };
}

export function useContentDetail(contentId) {
  const [data, setData] = useState(null);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const { source, localId } = parseContentId(id);
    logger().info('detail.fetch', { contentId: id, source, localId });

    try {
      // Try info first (works for both leaves and containers)
      const infoRes = await fetch(`/api/v1/info/${source}/${localId}`);
      if (!infoRes.ok) throw new Error(`Info failed: ${infoRes.status}`);
      const infoData = await infoRes.json();

      setData(infoData);

      // If container, also fetch children
      if (infoData.capabilities?.includes('listable') || infoData.type === 'show' || infoData.type === 'artist' || infoData.type === 'album' || infoData.type === 'season' || infoData.type === 'collection' || infoData.type === 'playlist') {
        const listRes = await fetch(`/api/v1/list/${source}/${localId}`);
        if (listRes.ok) {
          const listData = await listRes.json();
          setChildren(listData.items || []);
          if (listData.image && !infoData.thumbnail) {
            setData(prev => ({ ...prev, thumbnail: listData.image, image: listData.image }));
          }
          logger().info('detail.children-loaded', { contentId: id, childCount: (listData.items || []).length });
        }
      } else {
        setChildren([]);
      }

      logger().info('detail.loaded', { contentId: id, title: infoData.title, type: infoData.type });
    } catch (err) {
      // Fallback: try list API directly (for containers without info support)
      try {
        const { source: s, localId: l } = parseContentId(id);
        const listRes = await fetch(`/api/v1/list/${s}/${l}`);
        if (listRes.ok) {
          const listData = await listRes.json();
          setData({
            contentId: id,
            title: listData.title || l,
            thumbnail: listData.image,
            source: s,
            capabilities: ['listable'],
          });
          setChildren(listData.items || []);
          logger().info('detail.fallback-list', { contentId: id, childCount: (listData.items || []).length });
          setLoading(false);
          return;
        }
      } catch { /* fall through to error */ }

      logger().error('detail.fetch-failed', { contentId: id, error: err.message });
      setError(err.message);
      setData(null);
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDetail(contentId);
  }, [contentId, fetchDetail]);

  return { data, children, loading, error, refetch: () => fetchDetail(contentId) };
}
