import { useState, useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { idbGet, idbSet, idbClear } from './pianoListCache.js';

// Two-tier stale-while-revalidate cache:
//   L1 = in-memory Map (instant within a session)
//   L2 = IndexedDB (instant across reloads — see pianoListCache.js)
// On every fetch we revalidate against the API and only invalidate the UI when
// the items actually changed (signature compare), so a cache hit is a no-op
// re-render but a server change repaints.

const cache = new Map(); // path -> { items, at, sig }
const TTL_MS = 5 * 60_000;
const sigOf = (items) => { try { return JSON.stringify(items); } catch { return String(items?.length ?? 0); } };

export function __clearPianoListCache() { cache.clear(); idbClear(); }

/**
 * Cached list fetch. `select` maps the raw response to an array (default
 * res.items). Returns { data, loading, error }. data is null while first-loading,
 * [] when empty or path is null.
 */
export function usePianoList(path, select = (r) => r?.items ?? []) {
  const cached = path ? cache.get(path) : null;
  const [data, setData] = useState(cached ? cached.items : (path ? null : []));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) { setData([]); return undefined; }
    let cancelled = false;
    const l1 = cache.get(path);
    if (l1) setData(l1.items); // paint whatever we already have, instantly
    const l1Fresh = l1 && Date.now() - l1.at < TTL_MS;

    const revalidate = async (prevSig) => {
      try {
        const res = await DaylightAPI(path);
        if (cancelled) return;
        const items = select(res);
        const sig = sigOf(items);
        const entry = { items, at: Date.now(), sig };
        cache.set(path, entry);
        idbSet(path, entry);
        // Invalidate the UI only when the server's items differ from what's shown.
        if (sig !== prevSig) {
          setData(items);
          getLogger().child({ component: 'piano-list' }).debug('piano.list-revalidated', { path, changed: prevSig !== undefined });
        }
      } catch (err) {
        if (!cancelled) { setError(err.message); if (!cache.get(path)) setData([]); }
        getLogger().child({ component: 'piano-list' }).warn('piano.list-failed', { path, error: err.message });
      }
    };

    (async () => {
      if (l1Fresh) return; // L1 still fresh — no work
      if (!l1) {
        // Cold session: hydrate from IndexedDB for an instant paint, then decide.
        const persisted = await idbGet(path);
        if (cancelled) return;
        if (persisted?.items) {
          cache.set(path, persisted);
          setData(persisted.items);
          if (Date.now() - (persisted.at || 0) < TTL_MS) return; // persisted copy is fresh
          await revalidate(persisted.sig);
          return;
        }
      }
      await revalidate(l1?.sig);
    })();

    return () => { cancelled = true; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading: data === null, error };
}
export default usePianoList;
