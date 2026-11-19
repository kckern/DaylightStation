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

import { daylightApiResponse } from '../../../../../frontend/src/lib/api.mjs';

async function readFilter(url, signal) {
  const response = await daylightApiResponse(url, { signal });
  if (response.status === 404) return { data: null, status: 'none' };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { data: await response.json(), status: 'ready' };
}

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter-data' }));

export function useFilterData(contentId, { profile = 'family', enabled = true, retryDelayMs = 2000 } = {}) {
  const [state, setState] = useState({ url: null, data: null, status: 'idle' });
  const activeRead = useRef(null);
  const ratingKey = contentId ? String(contentId).replace(/^plex:/, '') : '';
  const url = enabled && ratingKey ? filterUrl(ratingKey, profile) : null;

  useEffect(() => {
    if (!url) {
      setState({ url, data: null, status: 'idle' });
      return;
    }
    let controller;
    let timer;
    setState({ url, data: null, status: 'loading' });

    async function read(refresh = false, attempt = 0) {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      try {
        const next = await readFilter(url, signal);
        if (signal.aborted) return;
        setState({ url, ...next });
        if (next.status === 'none') logger().debug?.('content-filter.load.none', { ratingKey });
        else logger().info?.(refresh ? 'content-filter.reloaded' : 'content-filter.loaded', {
          ratingKey, cues: next.data?.edl?.cues?.length || 0, profile: next.data?.profile?.name || null, attempt,
        });
      } catch (error) {
        if (signal.aborted) return;
        if (!refresh && attempt === 0) {
          logger().debug?.('content-filter.load.retry', { ratingKey, error: error.message, retryDelayMs });
          timer = setTimeout(() => read(false, 1), retryDelayMs);
          return;
        }
        setState(previous => previous.url === url && previous.status === 'loading'
          ? { url, data: null, status: 'failed' } : previous);
        logger().warn?.(refresh ? 'content-filter.reload.failed' : 'content-filter.load.failed', { ratingKey, error: error.message });
      }
    }

    activeRead.current = read;
    read();
    return () => {
      activeRead.current = null;
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, ratingKey, retryDelayMs]);

  const reload = useCallback(async () => { await activeRead.current?.(true); }, []);

  if (state.url !== url) return { data: null, status: url ? 'loading' : 'idle', reload };
  return { data: state.data, status: state.status, reload };
}

function filterUrl(ratingKey, profile) {
  return `/api/v1/content-filter/${encodeURIComponent(ratingKey)}?profile=${encodeURIComponent(profile)}`;
}
