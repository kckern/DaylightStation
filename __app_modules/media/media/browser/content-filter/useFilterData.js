/**
 * useFilterData — fetch the content-filter cascade (edl + profile + override) for
 * a title from /api/v1/content-filter/:ratingKey.
 *
 * Returns `{ data, status, reload }`, status one of:
 *   - idle     filtering disabled or no content id
 *   - loading  a fetch (or its one retry) is in flight; data is null, so the
 *              previous title's EDL never stays live while the next one loads
 *   - ready    data holds the cascade
 *   - none     404: the title has no filter data (not a failure)
 *   - failed   a network error or 5xx, retried once after retryDelayMs, failed
 *              again; logged as `content-filter.load.failed`
 *
 * `reload()` refetches the same title WITHOUT clearing `data` first, so filtering
 * keeps running while a preview edit is re-read; it resolves once the new data is
 * set (or, on failure, once the current data has been kept and the failure logged
 * as `content-filter.reload.failed`). It never rejects.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getChildLogger } from "../../../../../frontend/src/lib/logging/singleton.js";

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter-data' }));

export function useFilterData(contentId, { profile = 'family', enabled = true, retryDelayMs = 2000 } = {}) {
  const [state, setState] = useState({ data: null, status: 'idle' });
  // The title the current effect loaded; a reload that lands after the title
  // changed is dropped.
  const keyRef = useRef(null);

  useEffect(() => {
    if (!enabled || !contentId) { setState({ data: null, status: 'idle' }); return undefined; }
    const ratingKey = String(contentId).replace(/^plex:/, '');
    const url = filterUrl(ratingKey, profile);
    keyRef.current = url;
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
    return () => { cancelled = true; keyRef.current = null; if (timer) clearTimeout(timer); };
  }, [contentId, profile, enabled, retryDelayMs]);

  const reload = useCallback(async () => {
    const url = keyRef.current;
    if (!url) return;
    const ratingKey = String(contentId).replace(/^plex:/, '');
    try {
      const r = await fetch(url);
      if (keyRef.current !== url) return;
      if (r.status === 404) { setState({ data: null, status: 'none' }); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (keyRef.current !== url) return;
      setState({ data: d, status: 'ready' });
      logger().info?.('content-filter.reloaded', { ratingKey, cues: d?.edl?.cues?.length || 0 });
    } catch (e) {
      logger().warn?.('content-filter.reload.failed', { ratingKey, error: e?.message });
    }
  }, [contentId]);

  return { ...state, reload };
}

function filterUrl(ratingKey, profile) {
  return `/api/v1/content-filter/${ratingKey}?profile=${encodeURIComponent(profile)}`;
}
