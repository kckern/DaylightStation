/**
 * useFilterData — fetch the content-filter cascade (edl + profile + override) for
 * a title from /api/v1/content-filter/:ratingKey.
 *
 * Returns `{ data, status }`, status one of:
 *   - idle     filtering disabled or no content id
 *   - loading  a fetch (or its one retry) is in flight; data is null, so the
 *              previous title's EDL never stays live while the next one loads
 *   - ready    data holds the cascade
 *   - none     404: the title has no filter data (not a failure)
 *   - failed   a network error or 5xx, retried once after retryDelayMs, failed
 *              again; logged as `content-filter.load.failed`
 */
import { useEffect, useState } from 'react';
import { getChildLogger } from "../../../../../frontend/src/lib/logging/singleton.js";

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter-data' }));

export function useFilterData(contentId, { profile = 'family', enabled = true, retryDelayMs = 2000 } = {}) {
  const [state, setState] = useState({ data: null, status: 'idle' });

  useEffect(() => {
    if (!enabled || !contentId) { setState({ data: null, status: 'idle' }); return undefined; }
    const ratingKey = String(contentId).replace(/^plex:/, '');
    const url = `/api/v1/content-filter/${ratingKey}?profile=${encodeURIComponent(profile)}`;
    let cancelled = false;
    let timer = null;
    setState({ data: null, status: 'loading' });

    const attempt = (n) => fetch(url)
      .then((r) => {
        if (r.status === 404) return { kind: 'none' };
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json().then((d) => ({ kind: 'ready', d }));
      })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === 'none') {
          setState({ data: null, status: 'none' });
          logger().debug?.('content-filter.load.none', { ratingKey });
          return;
        }
        setState({ data: res.d, status: 'ready' });
        logger().info?.('content-filter.loaded', { ratingKey, cues: res.d?.edl?.cues?.length || 0, profile: res.d?.profile?.name || null, attempt: n });
      })
      .catch((e) => {
        if (cancelled) return;
        if (n === 0) {
          logger().debug?.('content-filter.load.retry', { ratingKey, error: e?.message, retryDelayMs });
          timer = setTimeout(() => { timer = null; attempt(1); }, retryDelayMs);
          return;
        }
        setState({ data: null, status: 'failed' });
        logger().warn?.('content-filter.load.failed', { ratingKey, error: e?.message });
      });

    attempt(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [contentId, profile, enabled, retryDelayMs]);

  return state;
}
