//
// The house { data, loading, error, reload } fetch hook — promoted from
// __app_modules/Auto/useAutoApi.js (same semantics: a request whose component
// unmounted mid-flight is discarded rather than written to state).
//
// Opt-in stale-while-revalidate (`swr: true`): a module-level cache keyed by
// `path` holds the last successful payload. A cache hit on mount (or on any
// later re-run of the fetch effect — path change, `reload()`) serves the
// cached value immediately with `loading: false`, while a `revalidating` flag
// reports that a background refresh is in flight. Callers that do not pass
// `swr` never touch the cache (see useApiResource.swr.test.jsx's "regression
// pin"); like every reader, they do share an identical request already in
// flight (see "In-flight dedupe" below). Cache
// writes go through two independent guards that do different jobs:
//   - `live` (per effect run) discards a response whose OWN component/effect
//     run is no longer current — unmount, path change, or an overlapping
//     older `reload()` on the SAME hook instance.
//   - a per-path generation token discards a response that is stale
//     RELATIVE TO ANOTHER REQUEST for the same path, including one issued by
//     a completely different mounted hook instance (e.g. two components
//     showing the same day's data side by side). `live` alone can't see
//     that: instance A's own effect stays "live" the whole time even while
//     instance B's later, faster request for the same path resolves first.
// See the "overlapping reloads" and "two mounts, same path" tests in
// useApiResource.swr.test.jsx.
import { useCallback, useEffect, useRef, useState } from 'react';
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

// A response can write to the cache while it holds the path's latest token.
// Unique tokens prevent an older read from regaining ownership after eviction.
// LRU eviction removes the corresponding token. A path that never writes to
// the cache can retain one token until the cache is reset.
const pathGenerations = new Map();
const invalidationListeners = new Set();
const patchListeners = new Set();

/** Revalidate mounted readers together without blanking same-key snapshots. */
export function invalidateApiResources(matches = () => true) {
  // Cached-but-unmounted entries (prefetched neighbours) become stale too:
  // they keep painting instantly, and the next prefetch pass refreshes them.
  for (const path of fetchedAt.keys()) if (matches(path)) fetchedAt.delete(path);
  for (const path of inFlight.keys()) if (matches(path)) inFlight.delete(path);
  // A prefetch can outlive a later request that replaced it in inFlight.
  for (const path of prefetchInFlight.keys()) if (matches(path)) claimGeneration(path);
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

function cacheSet(path, value, { persist = true } = {}) {
  swrCache.delete(path);
  swrCache.set(path, value);
  if (persist) schedulePersist(path, value);
  if (swrCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = swrCache.keys().next().value;
    swrCache.delete(oldestKey);
    pathGenerations.delete(oldestKey);
  }
}

// ---- Persistence ------------------------------------------------------------
// Opt-in, per app: registerResourcePersistence({ store, prefixes }) restores
// the paths under `prefixes` from disk into this cache (so a reopened page
// paints its last-seen data on the first frame) and writes every later cache
// write back, batched. Restored entries carry no fetchedAt: they are stale by
// definition, so every reader revalidates and the prefetcher refetches them.
// Memory LRU eviction leaves disk alone; the store prunes itself on load.
const PERSIST_FLUSH_MS = 400;
const PERSIST_MAX_ENTRY_BYTES = 512 * 1024;
const registrations = new Set();
const ownerListeners = new Set();

function registrationFor(path) {
  for (const registration of registrations) if (registration.matches(path)) return registration;
}

function schedulePersist(path, value) {
  const scope = registrationFor(path);
  // The stored owner can support a warm read while the app verifies the
  // current identity. That disk identity alone cannot authorize new writes.
  if (!scope?.confirmed) return;
  scope.pending.set(path, value);
  if (!scope.timer) scope.timer = setTimeout(scope.flush, PERSIST_FLUSH_MS);
}

export function registerResourcePersistence({ store, prefixes, owner, timeoutMs = 400 }) {
  if (!prefixes?.length || prefixes.some(prefix => typeof prefix !== 'string' || !prefix.length)) {
    throw new Error('Resource persistence requires nonempty path prefixes');
  }
  if ([...registrations].some(scope => scope.store === store || prefixes.some(prefix =>
    scope.prefixes.some(existing => existing.startsWith(prefix) || prefix.startsWith(existing))))) {
    throw new Error('Resource persistence registrations overlap');
  }
  const scope = {
    store, prefixes: [...prefixes], pending: new Map(), epoch: 0, owner: undefined, confirmed: false,
    matches: path => typeof path === 'string' && scope.prefixes.some(prefix => path.startsWith(prefix)),
    flush: () => {
      clearTimeout(scope.timer);
      scope.timer = null;
      for (const [path, value] of scope.pending) {
        if (value === undefined) { store.remove(path, scope.owner); continue; }
        let bytes;
        try { bytes = JSON.stringify(value)?.length ?? 0; } catch { continue; }
        if (bytes > PERSIST_MAX_ENTRY_BYTES) store.remove(path, scope.owner);
        else store.put(path, value, bytes, scope.owner);
      }
      scope.pending.clear();
    },
  };
  registrations.add(scope);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', scope.flush);

  function resetReaders() {
    scope.epoch++;
    clearTimeout(scope.timer);
    scope.timer = null;
    scope.pending.clear();
    let dropped = false;
    for (const path of swrCache.keys()) {
      if (!scope.matches(path)) continue;
      dropped = true;
      swrCache.delete(path);
      fetchedAt.delete(path);
      pathGenerations.delete(path);
    }
    for (const path of inFlight.keys()) if (scope.matches(path)) inFlight.delete(path);
    for (const path of prefetchInFlight.keys()) if (scope.matches(path)) prefetchInFlight.delete(path);
    prefetchQueue = prefetchQueue.filter(({ path }) => !scope.matches(path));
    if (isPrefetchIdle()) prefetchOnIdle = null;
    pumpPrefetch();
    for (const notify of ownerListeners) notify(scope.matches);
    return dropped;
  }
  function setOwner(next) {
    if (!registrations.has(scope) || !next) return false;
    scope.confirmed = true;
    if (scope.owner === next) return false;
    scope.owner = next;
    const dropped = resetReaders();
    if (store.claimOwner) store.claimOwner(next);
    else {
      store.clear();
      store.setOwner(next);
    }
    return dropped;
  }
  async function restore() {
    const epoch = scope.epoch;
    let timer;
    let loaded;
    try {
      loaded = await Promise.race([store.load(), new Promise(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      })]);
    } catch { /* use the network when storage fails */ }
    finally { clearTimeout(timer); }
    try {
      if (!registrations.has(scope) || epoch !== scope.epoch) return 0;
      scope.owner = loaded?.owner ?? null;
      if (owner) {
        const matchesDisk = owner === scope.owner;
        setOwner(owner);
        if (!matchesDisk) return 0;
      }
      if (!loaded?.owner) return 0;
      let restored = 0;
      for (const { path, value } of [...loaded.entries].reverse()) {
        if (!scope.matches(path) || swrCache.has(path)) continue;
        cacheSet(path, value, { persist: false });
        restored++;
      }
      return restored;
    } catch { return 0; }
  }
  function dispose() {
    if (!registrations.delete(scope)) return;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', scope.flush);
    resetReaders();
  }
  // A newly attached store defines a new ownership boundary even when reads
  // started before any store existed for these URLs.
  resetReaders();
  return { ready: restore(), setOwner, dispose, get owner() { return scope.owner; } };
}

export function flushApiResourcePersistence() { for (const scope of registrations) scope.flush(); }

// ---- In-flight dedupe --------------------------------------------------------
// Two readers mounting on one path in the same frame (a week strip and a chip
// both reading the week's budgets) used to issue two identical GETs, and on a
// browser that queues past six connections per host the duplicate delayed
// everything behind it. A reader or prefetch that finds the path already in
// flight joins that request. An explicit reload() starts its own read.
// Cache broadcasts retire the old request first, so affected readers can all
// join the first fresh read without taking a pre-change answer.
// Only a request issued moments ago is joined: the point is readers mounting
// together. A request still pending after that may be stuck, and a reader
// mounting later (navigating back) must get a fresh one, not wait on it.
// Provenance is attached only to actual network result objects. Local patches
// and disk-cache hydration never become evidence of a completed server read.
let resourceEvent = 0;
const networkStarts = new WeakMap();
export const nextApiResourceEvent = () => ++resourceEvent;
export const apiResourceReadToken = value => value && typeof value === 'object' ? networkStarts.get(value) ?? -1 : -1;
const JOIN_WINDOW_MS = 3000;
const inFlight = new Map(); // path -> { request, issuedAt, scope }

function sharedRequest(path, { join = true } = {}) {
  const current = inFlight.get(path);
  const scope = registrationFor(path);
  if (join && current && current.scope === scope && Date.now() - current.issuedAt < JOIN_WINDOW_MS) return current.request;
  const issuedEvent = nextApiResourceEvent();
  const request = new Promise(resolve => resolve(DaylightAPI(path))).then(result => {
    if (result && typeof result === 'object') networkStarts.set(result, issuedEvent);
    return result;
  });
  inFlight.set(path, { request, issuedAt: Date.now(), scope });
  const settle = () => { if (inFlight.get(path)?.request === request) inFlight.delete(path); };
  request.then(settle, settle);
  return request;
}

// ---- Transient retry -----------------------------------------------------------
// A proxy's 502/503/504 or a dropped connection (api.mjs marks these
// `transient`) is almost always the backend restarting: the same GET asked
// again seconds later succeeds. A reader asks again on this schedule before
// it reports anything, and stops as soon as it is no longer current.
export const TRANSIENT_RETRY_DELAYS_MS = [1000, 3000];

function requestWithRetry(path, { join, isCurrent, onRetry }) {
  const attempt = (index, joinThis) => sharedRequest(path, { join: joinThis }).catch(err => {
    const delay = TRANSIENT_RETRY_DELAYS_MS[index];
    if (!err?.transient || delay === undefined || !isCurrent()) throw err;
    onRetry(err, index + 1);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!isCurrent()) { reject(err); return; }
        // The failed request is already retired. A pending replacement is
        // fresh enough for readers recovering from the same failure.
        attempt(index + 1, true).then(resolve, reject);
      }, delay);
    });
  });
  return attempt(0, join);
}

// Claims a new generation token for `path` — call this once per issued
// request, at issue time, and keep the returned number to check against
// `isNewestGeneration` when that request resolves.
function claimGeneration(path) {
  const next = Symbol();
  pathGenerations.set(path, next);
  return next;
}

function isNewestGeneration(path, generation) {
  return pathGenerations.get(path) === generation;
}

// ---- Prefetch --------------------------------------------------------------
// Fills the same swr cache ahead of a reader, so a view that mounts on that
// path paints instantly (and still revalidates quietly, as every swr hit
// does). Low priority by construction: a small concurrency cap, queued work
// is replaceable wholesale when the user moves, and a response only writes the
// cache if no newer request for that path was issued meanwhile.
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_FRESH_MS = 60_000;
const fetchedAt = new Map();
let prefetchQueue = [];
const prefetchInFlight = new Map();
// Cumulative since page load (or the last reset): what the prefetcher was
// asked to warm, and how it went. Read by callers that report on it.
const prefetchStats = { queued: 0, completed: 0, failed: 0 };
let prefetchOnIdle = null; // the latest caller's "queue drained" callback

function pumpPrefetch() {
  while (prefetchInFlight.size < PREFETCH_CONCURRENCY && prefetchQueue.length) {
    const task = prefetchQueue.shift();
    const { path, onDone } = task;
    const generation = claimGeneration(path);
    prefetchInFlight.set(path, task);
    const isCurrent = () => prefetchInFlight.get(path) === task;
    sharedRequest(path)
      .then(result => {
        if (!isCurrent()) return;
        if (isNewestGeneration(path, generation)) { cacheSet(path, result); fetchedAt.set(path, Date.now()); }
        prefetchStats.completed += 1;
        onDone?.(null, path);
      })
      .catch(err => { if (!isCurrent()) return; prefetchStats.failed += 1; onDone?.(err, path); })
      .finally(() => { if (!isCurrent()) return; prefetchInFlight.delete(path); pumpPrefetch();
        if (isPrefetchIdle() && prefetchOnIdle) { const onIdle = prefetchOnIdle; prefetchOnIdle = null; onIdle(getPrefetchStats()); } });
  }
}

/** Prefetch counters since load: `{ queued, completed, failed }` (a copy). */
export function getPrefetchStats() {
  return { ...prefetchStats };
}

/** True when nothing is queued or in flight. */
export function isPrefetchIdle() {
  return prefetchInFlight.size === 0 && prefetchQueue.length === 0;
}

/** True when the swr cache holds a payload for `path` fetched recently. */
export function isApiResourceFresh(path, maxAgeMs = PREFETCH_FRESH_MS) {
  return swrCache.has(path) && Date.now() - (fetchedAt.get(path) || 0) < maxAgeMs;
}

/** The cached payload for `path`, or undefined. Does not touch recency. */
export function peekApiResource(path) {
  return swrCache.get(path);
}

/** Write a payload fetched outside the hook (same freshness bookkeeping). */
export function primeApiResource(path, value) {
  cacheSet(path, value);
  fetchedAt.set(path, Date.now());
}

/**
 * Write a change the server has already committed into a cached resource and
 * show it on every mounted reader at once, instead of waiting for a refetch
 * that can queue behind everything else the page has in flight. Each reader
 * then revalidates, so the server's copy replaces the patch when it lands.
 * Claiming a generation keeps a request issued BEFORE the patch (a poll, a
 * prefetch) from writing the pre-write value back over it.
 *
 * `update(current)` returns the next value, or undefined to leave it alone.
 * Returns false when nothing has loaded the path yet: there is nothing on
 * screen to patch, and the reader's own load will include the change.
 */
export function patchApiResource(path, update) {
  if (!swrCache.has(path)) return false;
  const next = update(swrCache.get(path));
  if (next === undefined) return false;
  inFlight.delete(path);
  claimGeneration(path);
  cacheSet(path, next);
  for (const notify of patchListeners) notify(path, next);
  return true;
}

/**
 * Replace the prefetch queue with `paths`, in priority order. Paths already
 * fresh in the cache are skipped; requests already in flight finish.
 * `onIdle(stats)` fires once, when the queue and in-flight set drain.
 */
export function prefetchApiResources(paths, { onDone, onIdle } = {}) {
  prefetchOnIdle = typeof onIdle === 'function' ? onIdle : null;
  prefetchQueue = [...new Set(paths)].filter(path => path && !isApiResourceFresh(path) && !prefetchInFlight.has(path)).map(path => ({ path, onDone }));
  const accepted = prefetchQueue.length;
  prefetchStats.queued += accepted;
  pumpPrefetch();
  // Nothing to fetch and nothing in flight: this call's neighbourhood is
  // already warm, so report now (with the caller's own context) rather than
  // leave the callback waiting for a drain that will not come.
  if (isPrefetchIdle() && prefetchOnIdle) { const onIdle = prefetchOnIdle; prefetchOnIdle = null; onIdle(getPrefetchStats()); }
  return accepted;
}

// A path reset drops that snapshot from memory and persistent storage. Use
// invalidateApiResources to revalidate mounted readers. The no-argument reset
// is for tests and clears memory only, leaving attached stores intact.
export function resetApiResourceCache(path) {
  if (path === undefined) { swrCache.clear(); pathGenerations.clear(); fetchedAt.clear(); inFlight.clear(); for (const scope of registrations) scope.pending.clear(); prefetchQueue = []; prefetchInFlight.clear(); prefetchOnIdle = null; Object.assign(prefetchStats, { queued: 0, completed: 0, failed: 0 }); return; }
  swrCache.delete(path);
  pathGenerations.delete(path);
  fetchedAt.delete(path);
  schedulePersist(path, undefined);
}

function refreshAbortError() {
  const error = new Error('Resource refresh was superseded before it completed');
  error.name = 'AbortError';
  return error;
}

export function useApiResource(path, {
  deps = [], enabled = true, label, logger = defaultLogger,
  swr = false, retryTransient = true, clearDataOnError = false,
} = {}) {
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
  const [reloadRequest, setReloadRequest] = useState(null);
  const requestedReload = useRef(reloadRequest);
  const activePath = useRef(null);
  const activeRead = useRef(null);
  const pendingRefresh = useRef(null);

  const cancelRefresh = useCallback(() => {
    const pending = pendingRefresh.current;
    pendingRefresh.current = null;
    pending?.reject(refreshAbortError());
  }, []);
  const requestReload = useCallback((waiter, join = false) => {
    cancelRefresh();
    const next = { join };
    requestedReload.current = next;
    if (waiter) pendingRefresh.current = { ...waiter, request: next };
    setReloadRequest(next);
  }, [cancelRefresh]);
  const reload = useCallback(() => { requestReload(); }, [requestReload]);
  const refresh = useCallback(() => {
    if (!enabled || !path || activePath.current !== path) return Promise.reject(refreshAbortError());
    return new Promise((resolve, reject) => {
      requestReload({ resolve, reject });
    });
  }, [enabled, path, requestReload]);
  const fetchedReload = useRef(reloadRequest);
  // Interval ticks leave the active read and any refresh waiting for an
  // effect alone. An explicit or foreground reload may still supersede them.
  const poll = useCallback(() => {
    if (!path || activePath.current !== path || activeRead.current
      || fetchedReload.current !== requestedReload.current) return;
    requestReload(null, true);
  }, [path, requestReload]);

  useEffect(() => {
    activePath.current = enabled ? path : null;
    const notify = matches => { if (enabled && path && matches(path)) requestReload(null, true); };
    const clearOwner = matches => {
      if (!path || !matches(path)) return;
      setData(null);
      setError(null);
      if (enabled) requestReload(null, true);
    };
    invalidationListeners.add(notify);
    ownerListeners.add(clearOwner);
    return () => {
      activePath.current = null;
      cancelRefresh();
      invalidationListeners.delete(notify);
      ownerListeners.delete(clearOwner);
    };
  }, [path, enabled, requestReload, cancelRefresh]);

  // Adopt a patch now, then revalidate. The reload also retires this hook's
  // in-flight request (its `live` flag), which predates the patch.
  useEffect(() => {
    if (!swr) return undefined;
    const notify = (patched, value) => {
      if (!enabled || patched !== path) return;
      setData(value);
      setResultPath(path);
      requestReload(null, true);
    };
    patchListeners.add(notify);
    return () => patchListeners.delete(notify);
  }, [path, enabled, swr, requestReload]);

  useEffect(() => {
    const takeRefresh = () => {
      const pending = pendingRefresh.current;
      if (!pending || pending.request !== reloadRequest) return null;
      pendingRefresh.current = null;
      return pending;
    };
    if (!enabled || !path) { setLoading(false); return undefined; }
    let live = true;
    const scope = registrationFor(path);
    const epoch = scope?.epoch;
    const isCurrent = () => live && reloadRequest === requestedReload.current &&
      scope === registrationFor(path) && scope?.epoch === epoch;
    activeRead.current = isCurrent;
    const releaseRead = () => {
      if (activeRead.current === isCurrent) activeRead.current = null;
    };

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

    const join = fetchedReload.current === reloadRequest || reloadRequest?.join;
    fetchedReload.current = reloadRequest;
    const startedAt = performance.now();
    const request = retryTransient
      ? requestWithRetry(path, { join, isCurrent,
        onRetry: (err, attempt) => logger.debug('api.retry', { resource: label || path, attempt, status: err?.status ?? null }) })
      : sharedRequest(path, { join });
    request
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
        if (!isCurrent()) return;
        if (swr && isNewestGeneration(path, myGeneration)) { cacheSet(path, result); fetchedAt.set(path, Date.now()); }
        setData(result);
        setResultPath(path);
        setLoading(false);
        if (swr) setRevalidating(false);
        takeRefresh()?.resolve(result);
        logger.debug(cacheHit ? 'api.revalidated' : 'api.loaded', { resource: label || path, ms: Math.round(performance.now() - startedAt) });
      })
      .catch((err) => {
        if (!isCurrent()) return;
        if (clearDataOnError) setData(null);
        setError(err);
        setLoading(false);
        if (swr) setRevalidating(false);
        takeRefresh()?.reject(err);
        logger.warn('api.failed', { resource: label || path, error: err?.message });
      })
      .finally(releaseRead);

    return () => {
      live = false;
      releaseRead();
      takeRefresh()?.reject(refreshAbortError());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, reloadRequest, swr, retryTransient, clearDataOnError, ...deps]);

  // Effects run after render: conceal the previous key synchronously, not
  // just after the new request starts, so stale rows are never actionable.
  // With swr, a key change that the cache already holds paints that key's
  // own snapshot in the SAME render instead of one empty frame first — the
  // flash a day flip used to show before the effect copied the cache over.
  const matches = resultPath === path;
  if (!matches && swr && enabled && path && swrCache.has(path)) {
    return { data: swrCache.get(path), resourceKey: path, loading: false, error: null, revalidating: true, reload, refresh, poll };
  }
  return { data: matches ? data : null, resourceKey: path,
    loading: matches ? loading : Boolean(enabled && path),
    error: matches ? error : null, revalidating: matches && revalidating, reload, refresh, poll };
}

export default useApiResource;
