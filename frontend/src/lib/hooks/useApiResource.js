//
// The house { data, loading, error, reload } fetch hook — promoted from
// modules/Auto/useAutoApi.js (same semantics: a request whose component
// unmounted mid-flight is discarded rather than written to state).
//
// Opt-in stale-while-revalidate (`swr: true`): a module-level cache keyed by
// `path` holds the last successful payload. A cache hit on mount (or on any
// later re-run of the fetch effect — path change, `reload()`) serves the
// cached value immediately with `loading: false`, while a `revalidating` flag
// reports that a background refresh is in flight. Callers that do not pass
// `swr` never touch the cache and see byte-identical behavior to before this
// option existed — see useApiResource.swr.test.jsx's "regression pin". Cache
// writes are gated by the same per-effect-run liveness flag as state writes,
// so a superseded response (unmount, path change, or an overlapping older
// `reload()`) can never clobber a cache entry a newer request already wrote
// — see the "overlapping reloads" tests in that same file.
import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../api.mjs';
import { createAppLogger } from '../ui/createAppLogger.js';

const defaultLogger = createAppLogger('ds');

// Bound growth: this cache is process-lifetime, not per-session-cleared. The
// realistic worst case today is date-keyed paths (health nutrilist/budget per
// day) as a user pages through history — tens of entries in a long session,
// not thousands. 100 entries comfortably covers that while capping memory for
// a kiosk tab left open for days. Eviction is LRU by access/write recency.
const MAX_CACHE_ENTRIES = 100;
const swrCache = new Map();

function cacheGet(path) {
  if (!swrCache.has(path)) return { hit: false };
  const value = swrCache.get(path);
  // Touch for recency: delete+set moves this key to the end of Map's
  // insertion-ordered iteration, which is what the LRU eviction below reads.
  swrCache.delete(path);
  swrCache.set(path, value);
  return { hit: true, value };
}

function cacheSet(path, value) {
  swrCache.delete(path);
  swrCache.set(path, value);
  if (swrCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = swrCache.keys().next().value;
    swrCache.delete(oldestKey);
  }
}

// Test-only reset, and the seam a later task (day-view mutation) can use to
// invalidate a specific path after a write — call with a path to drop just
// that entry, or with no argument to clear everything.
export function resetApiResourceCache(path) {
  if (path === undefined) { swrCache.clear(); return; }
  swrCache.delete(path);
}

export function useApiResource(path, { deps = [], enabled = true, label, logger = defaultLogger, swr = false } = {}) {
  // Single shared cache lookup for the three lazy initializers below — each
  // useState initializer only runs once (on mount), and all three run inside
  // the same render, so a memoized closure keeps `cacheGet` (which mutates
  // the Map's iteration order for LRU) to one real call instead of three.
  let initialCache;
  const getInitialCache = () => (initialCache ??= (swr && path) ? cacheGet(path) : { hit: false });

  const [data, setData] = useState(() => {
    const { hit, value } = getInitialCache();
    return hit ? value : null;
  });
  const [loading, setLoading] = useState(() => {
    if (!(enabled && path)) return false;
    return !getInitialCache().hit;
  });
  const [revalidating, setRevalidating] = useState(() => getInitialCache().hit);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !path) { setLoading(false); return undefined; }
    let live = true;

    const { hit: cacheHit, value: cachedValue } = swr ? cacheGet(path) : { hit: false };
    if (cacheHit) {
      setData(cachedValue);
      setRevalidating(true);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
    }

    const startedAt = performance.now();
    DaylightAPI(path)
      .then((result) => {
        // `live` is this specific effect run's liveness — it goes false on
        // unmount AND on any dependency change that tears this run down
        // (path change, `reload()`, swr/enabled/deps change). Checking it
        // BEFORE the cache write (not just before the state writes) is load
        // bearing: two overlapping reloads each get their own effect run and
        // their own `live`; if the older one's response resolves after the
        // newer one's, its `live` is already false by then, so it can never
        // clobber the cache with a stale value the newer run already
        // replaced. The trade-off: a response for a path this hook has since
        // abandoned (unmount, or moved on to a different path) is dropped
        // entirely rather than opportunistically cached — correctness for
        // "last-issued wins" over squeezing a little more cache mileage out
        // of a request nobody is waiting on anymore.
        if (!live) return;
        if (swr) cacheSet(path, result);
        setData(result);
        setLoading(false);
        if (swr) setRevalidating(false);
        logger.debug(cacheHit ? 'api.revalidated' : 'api.loaded', { resource: label || path, ms: Math.round(performance.now() - startedAt) });
      })
      .catch((err) => {
        if (!live) return;
        setError(err);
        setLoading(false);
        if (swr) setRevalidating(false);
        logger.warn('api.failed', { resource: label || path, error: err?.message });
      });

    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, nonce, swr, ...deps]);

  return { data, loading, error, revalidating, reload };
}

export default useApiResource;
