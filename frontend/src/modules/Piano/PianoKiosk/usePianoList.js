import { useState, useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';

const cache = new Map(); // path -> { items, at }
const TTL_MS = 5 * 60_000;
export function __clearPianoListCache() { cache.clear(); }

/**
 * Cached list fetch with stale-while-revalidate. `select` maps the raw response
 * to an array (default: res.items). Returns { data, loading, error }.
 * data is null while first-loading, [] when empty or path is null.
 */
export function usePianoList(path, select = (r) => r?.items ?? []) {
  const cached = path ? cache.get(path) : null;
  const [data, setData] = useState(cached ? cached.items : (path ? null : []));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) { setData([]); return undefined; }
    let cancelled = false;
    const fresh = cache.get(path);
    if (fresh && Date.now() - fresh.at < TTL_MS) { setData(fresh.items); return undefined; }
    if (fresh) setData(fresh.items); // stale: show immediately, revalidate below
    (async () => {
      try {
        const res = await DaylightAPI(path);
        const items = select(res);
        if (!cancelled) { cache.set(path, { items, at: Date.now() }); setData(items); }
      } catch (err) {
        if (!cancelled) { setError(err.message); if (!fresh) setData([]); }
        getLogger().child({ component: 'piano-list' }).warn('piano.list-failed', { path, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading: data === null, error };
}
export default usePianoList;
