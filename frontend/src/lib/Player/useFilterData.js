/**
 * useFilterData — fetch the content-filter cascade (edl + profile + override) for
 * a title from /api/v1/content-filter/:ratingKey. Returns null when filtering is
 * disabled or no filter data exists for the title (404), so the caller no-ops.
 */
import { useEffect, useState } from 'react';
import { getChildLogger } from '../logging/singleton.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter-data' }));

export function useFilterData(contentId, { profile = 'family', enabled = true } = {}) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!enabled || !contentId) { setData(null); return undefined; }
    const ratingKey = String(contentId).replace(/^plex:/, '');
    let cancelled = false;
    fetch(`/api/v1/content-filter/${ratingKey}?profile=${encodeURIComponent(profile)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setData(d);
        logger().info?.('content-filter.loaded', { ratingKey, cues: d?.edl?.cues?.length || 0, profile: d?.profile?.name || null });
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        logger().warn?.('content-filter.load-failed', { ratingKey, error: e?.message });
      });
    return () => { cancelled = true; };
  }, [contentId, profile, enabled]);

  return data;
}
