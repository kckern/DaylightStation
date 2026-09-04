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
// writes go through two independent guards that do different jobs:
//   - `live` (per effect run) discards a response whose OWN component/effect
//     run is no longer current — unmount, path change, or an overlapping
//     older `reload()` on the SAME hook instance.
//   - a per-path generation counter discards a response that is stale
//     RELATIVE TO ANOTHER REQUEST for the same path, including one issued by
//     a completely different mounted hook instance (e.g. two components
//     showing the same day's data side by side). `live` alone can't see
//     that: instance A's own effect stays "live" the whole time even while
//     instance B's later, faster request for the same path resolves first.
// See the "overlapping reloads" and "two mounts, same path" tests in
// useApiResource.swr.test.jsx.
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

// Per-path "who issued the request that should win" counter. Every request a
// swr-enabled hook issues for a path claims the next number; a response only
// gets to write the cache if its number is still the highest issued for that
// path at the time it resolves — i.e. it's provably the most-recently-issued
// request, regardless of which mounted component instance issued it or how
// long each one took to come back. An entry is dropped only as a side effect
// of swrCache's own LRU eviction (below), which only happens on a successful
// cache write — a path that never writes the cache (every request for it
// fails, or is always superseded before it can) keeps its counter here
// indefinitely. That's a real, unbounded-in-theory growth path, just a slow
// and low-severity one: it costs one Map entry per distinct never-succeeding
// path, not per request.
const pathGenerations = new Map();
const invalidationListeners = new Set();

/** Revalidate mounted readers together without blanking same-key snapshots. */
export function invalidateApiResources(matches = () => true) {
  for (const notify of invalidationListeners) notify(matches);
}

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
    pathGenerations.delete(oldestKey);
  }
}

// Claims the next generation number for `path` — call this once per issued
// request, at issue time, and keep the returned number to check against
// `isNewestGeneration` when that request resolves.
function claimGeneration(path) {
  const next = (pathGenerations.get(path) || 0) + 1;
  pathGenerations.set(path, next);
  return next;
}

function isNewestGeneration(path, generation) {
  return pathGenerations.get(path) === generation;
}

// Test-only reset, and the seam a later task (day-view mutation) can use to
// invalidate a specific path after a write — call with a path to drop just
// that entry, or with no argument to clear everything.
export function resetApiResourceCache(path) {
  if (path === undefined) { swrCache.clear(); pathGenerations.clear(); return; }
  swrCache.delete(path);
  pathGenerations.delete(path);
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
  const [resultPath, setResultPath] = useState(path);
  const [loading, setLoading] = useState(() => {
    if (!(enabled && path)) return false;
    return !getInitialCache().hit;
  });
  const [revalidating, setRevalidating] = useState(() => getInitialCache().hit);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const notify = matches => { if (enabled && path && matches(path)) reload(); };
    invalidationListeners.add(notify);
    return () => invalidationListeners.delete(notify);
  }, [path, enabled, reload]);

  useEffect(() => {
    if (!enabled || !path) { setLoading(false); return undefined; }
    let live = true;

    const { hit: cacheHit, value: cachedValue } = swr ? cacheGet(path) : { hit: false };
    if (cacheHit) {
      setData(cachedValue);
      setResultPath(path);
      setRevalidating(true);
      setLoading(false);
      setError(null);
    } else {
      if (resultPath !== path) setData(null);
      setResultPath(path);
      setRevalidating(false);
      setLoading(true);
      setError(null);
    }

    // Claimed at issue time (not resolve time) so "which request is newest
    // for this path" reflects issue order, matching the state-write side's
    // "last-issued wins" semantics for the single-instance case.
    const myGeneration = swr ? claimGeneration(path) : null;

    const startedAt = performance.now();
    DaylightAPI(path)
      .then((result) => {
        // Two independent guards here, doing different jobs:
        //   - `live` is THIS effect run's own liveness — false on unmount or
        //     on any dependency change that tears this run down (path
        //     change, `reload()`, swr/enabled/deps change). It protects
        //     STATE: a component whose own request/effect is superseded
        //     should not paint a response it no longer represents.
        //   - the generation check protects the CACHE specifically: it's
        //     false when some OTHER request for the same path — possibly
        //     from a different mounted instance whose own `live` is still
        //     true — was issued more recently and hasn't necessarily
        //     resolved yet. Without it, two components mounted on the same
        //     path could race and let whichever response happens to resolve
        //     last win the cache, even if it was issued first (i.e. is
        //     actually the staler answer).
        if (!live) return;
        if (swr && isNewestGeneration(path, myGeneration)) cacheSet(path, result);
        setData(result);
        setResultPath(path);
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

  // Effects run after render: conceal the previous key synchronously, not
  // just after the new request starts, so stale rows are never actionable.
  const matches = resultPath === path;
  return { data: matches ? data : null, resourceKey: path,
    loading: matches ? loading : Boolean(enabled && path),
    error: matches ? error : null, revalidating: matches && revalidating, reload };
}

export default useApiResource;
