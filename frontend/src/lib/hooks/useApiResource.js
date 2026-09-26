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
// `swr` never touch the cache (see useApiResource.swr.test.jsx's "regression
// pin"); like every reader, they do share an identical request already in
// flight (see "In-flight dedupe" below). Cache
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
const patchListeners = new Set();

/** Revalidate mounted readers together without blanking same-key snapshots. */
export function invalidateApiResources(matches = () => true) {
  // Cached-but-unmounted entries (prefetched neighbours) become stale too:
  // they keep painting instantly, and the next prefetch pass refreshes them.
  for (const path of fetchedAt.keys()) if (matches(path)) fetchedAt.delete(path);
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
// Opt-in, per app: attachApiResourcePersistence({ store, prefixes }) restores
// the paths under `prefixes` from disk into this cache (so a reopened page
// paints its last-seen data on the first frame) and writes every later cache
// write back, batched. Restored entries carry no fetchedAt: they are stale by
// definition, so every reader revalidates and the prefetcher refetches them.
// Memory LRU eviction leaves disk alone; the store prunes itself on load.
const PERSIST_FLUSH_MS = 400;
const PERSIST_MAX_ENTRY_BYTES = 512 * 1024;
let persistence = null; // { store, matches(path), owner }
const pendingWrites = new Map(); // path -> value, or undefined to delete
let flushTimer = null;

function schedulePersist(path, value) {
  if (!persistence?.matches(path)) return;
  pendingWrites.set(path, value);
  if (!flushTimer) flushTimer = setTimeout(flushPersist, PERSIST_FLUSH_MS);
}

function flushPersist() {
  flushTimer = null;
  const batch = [...pendingWrites];
  pendingWrites.clear();
  if (!persistence) return;
  const { store } = persistence;
  for (const [path, value] of batch) {
    if (value === undefined) { store.remove(path); continue; }
    let bytes;
    try { bytes = JSON.stringify(value)?.length ?? 0; } catch { continue; }
    // One oversized payload must not push every small one off disk.
    if (bytes > PERSIST_MAX_ENTRY_BYTES) store.remove(path);
    else store.put(path, value, bytes);
  }
}

/**
 * Back the swr cache with `store` (see persistentResourceStore.js) for paths
 * starting with any of `prefixes`, and restore what it holds. Resolves with
 * the number of entries restored — 0 when the store is empty, unavailable, or
 * slower than `timeoutMs` (a slow disk must not hold the first paint hostage;
 * the page just loads from the network as it always did).
 */
export async function attachApiResourcePersistence({ store, prefixes, timeoutMs = 400 }) {
  const matches = path => typeof path === 'string' && prefixes.some(prefix => path.startsWith(prefix));
  // `owner` is undefined until the disk has actually been read: "I could not
  // read whose data this is" must never pass for "the disk has no owner yet".
  // One global slot: a second attach replaces the first (one app per page).
  const attached = { store, matches, owner: undefined };
  persistence = attached;
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushApiResourcePersistence);
  let loaded = null;
  try {
    loaded = await Promise.race([store.load(), new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))]);
  } catch { loaded = null; }
  if (persistence !== attached || !loaded) return 0;
  attached.owner = loaded.owner ?? null;
  // Oldest first, so the memory LRU keeps the NEWEST when disk holds more
  // entries than memory does.
  let restored = 0;
  for (const { path, value } of [...loaded.entries].reverse()) {
    if (!matches(path) || swrCache.has(path)) continue;
    cacheSet(path, value, { persist: false });
    restored += 1;
  }
  return restored;
}

/** Stop persisting (tests; an app tearing its cache down). Memory is kept. */
export function detachApiResourcePersistence() {
  persistence = null;
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushApiResourcePersistence);
  pendingWrites.clear();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}

/** Whose data the persisted paths hold: an id, null (nobody yet), or undefined (unknown). */
export function getApiResourceOwner() {
  return persistence?.owner;
}

/**
 * Declare whose data the persisted paths hold, from an answer the SERVER just
 * gave. Disk snapshots belong to one person. Unless the disk was read and
 * recorded nobody (a first visit), a different owner clears the disk, and
 * everything that came from disk is dropped from memory and from every
 * mounted reader's screen, which then refetches. Entries fetched from the
 * network since load already belong to the new owner and are kept. Returns
 * true when it dropped anything.
 */
export function claimApiResourceOwner(owner) {
  const attached = persistence;
  if (!attached || !owner || attached.owner === owner) return false;
  const previous = attached.owner;
  attached.owner = owner;
  if (previous === null) { attached.store.setOwner(owner); return false; }
  attached.store.clear();
  attached.store.setOwner(owner);
  pendingWrites.clear();
  const dropped = [];
  for (const path of [...swrCache.keys()]) {
    if (!attached.matches(path)) continue;
    if (fetchedAt.has(path)) schedulePersist(path, swrCache.get(path));
    else { swrCache.delete(path); dropped.push(path); }
  }
  // Blank them on screen too (a patch to null), not just in the cache: a
  // reader re-running on a cache miss keeps whatever it last showed.
  for (const path of dropped) for (const notify of patchListeners) notify(path, null);
  return dropped.length > 0;
}

/** Flush batched disk writes now (tests; page hide). */
export function flushApiResourcePersistence() {
  if (flushTimer) clearTimeout(flushTimer);
  flushPersist();
}

// ---- In-flight dedupe --------------------------------------------------------
// Two readers mounting on one path in the same frame (a week strip and a chip
// both reading the week's budgets) used to issue two identical GETs, and on a
// browser that queues past six connections per host the duplicate delayed
// everything behind it. A reader or prefetch that finds the path already in
// flight joins that request. An explicit reload() never joins: it is asked
// for BECAUSE something changed after the in-flight request was issued, and
// joining would hand back the pre-change answer.
// Only a request issued moments ago is joined: the point is readers mounting
// together. A request still pending after that may be stuck, and a reader
// mounting later (navigating back) must get a fresh one, not wait on it.
const JOIN_WINDOW_MS = 3000;
const inFlight = new Map(); // path -> { request, issuedAt }

function sharedRequest(path, { join = true } = {}) {
  const current = inFlight.get(path);
  if (join && current && Date.now() - current.issuedAt < JOIN_WINDOW_MS) return current.request;
  const request = new Promise(resolve => resolve(DaylightAPI(path)));
  inFlight.set(path, { request, issuedAt: Date.now() });
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
        attempt(index + 1, false).then(resolve, reject);
      }, delay);
    });
  });
  return attempt(0, join);
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
let prefetchActive = 0;
const prefetchInFlight = new Set();
let prefetchEpoch = 0; // bumped by resetApiResourceCache so stale in-flight work can't hold slots
// Cumulative since page load (or the last reset): what the prefetcher was
// asked to warm, and how it went. Read by callers that report on it.
const prefetchStats = { queued: 0, completed: 0, failed: 0 };
let prefetchOnIdle = null; // the latest caller's "queue drained" callback

function pumpPrefetch() {
  while (prefetchActive < PREFETCH_CONCURRENCY && prefetchQueue.length) {
    const { path, onDone } = prefetchQueue.shift();
    const generation = claimGeneration(path);
    const epoch = prefetchEpoch;
    prefetchActive += 1;
    prefetchInFlight.add(path);
    sharedRequest(path)
      .then(result => {
        if (epoch !== prefetchEpoch) return;
        if (isNewestGeneration(path, generation)) { cacheSet(path, result); fetchedAt.set(path, Date.now()); }
        prefetchStats.completed += 1;
        onDone?.(null, path);
      })
      .catch(err => { if (epoch !== prefetchEpoch) return; prefetchStats.failed += 1; onDone?.(err, path); })
      .finally(() => { if (epoch !== prefetchEpoch) return; prefetchActive -= 1; prefetchInFlight.delete(path); pumpPrefetch();
        if (isPrefetchIdle() && prefetchOnIdle) { const onIdle = prefetchOnIdle; prefetchOnIdle = null; onIdle(getPrefetchStats()); } });
  }
}

/** Prefetch counters since load: `{ queued, completed, failed }` (a copy). */
export function getPrefetchStats() {
  return { ...prefetchStats };
}

/** True when nothing is queued or in flight. */
export function isPrefetchIdle() {
  return prefetchActive === 0 && prefetchQueue.length === 0;
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
  prefetchQueue = paths.filter(path => path && !isApiResourceFresh(path) && !prefetchInFlight.has(path)).map(path => ({ path, onDone }));
  const accepted = prefetchQueue.length;
  prefetchStats.queued += accepted;
  pumpPrefetch();
  // Nothing to fetch and nothing in flight: this call's neighbourhood is
  // already warm, so report now (with the caller's own context) rather than
  // leave the callback waiting for a drain that will not come.
  if (isPrefetchIdle() && prefetchOnIdle) { const onIdle = prefetchOnIdle; prefetchOnIdle = null; onIdle(getPrefetchStats()); }
  return accepted;
}

// Test-only reset, and the seam a later task (day-view mutation) can use to
// invalidate a specific path after a write — call with a path to drop just
// that entry, or with no argument to clear everything. A path reset also
// deletes it from the persistent store; the no-argument reset clears MEMORY
// only, so an attached store would restore those entries on the next attach.
export function resetApiResourceCache(path) {
  if (path === undefined) { swrCache.clear(); pathGenerations.clear(); fetchedAt.clear(); inFlight.clear(); pendingWrites.clear(); prefetchQueue = []; prefetchActive = 0; prefetchInFlight.clear(); prefetchEpoch += 1; prefetchOnIdle = null; Object.assign(prefetchStats, { queued: 0, completed: 0, failed: 0 }); return; }
  swrCache.delete(path);
  pathGenerations.delete(path);
  fetchedAt.delete(path);
  schedulePersist(path, undefined);
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
  // The nonce the last fetch ran under: a run with a new nonce is a reload().
  const fetchedNonce = useRef(nonce);

  useEffect(() => {
    const notify = matches => { if (enabled && path && matches(path)) reload(); };
    invalidationListeners.add(notify);
    return () => invalidationListeners.delete(notify);
  }, [path, enabled, reload]);

  // Adopt a patch now, then revalidate. The reload also retires this hook's
  // in-flight request (its `live` flag), which predates the patch.
  useEffect(() => {
    if (!swr) return undefined;
    const notify = (patched, value) => {
      if (!enabled || patched !== path) return;
      setData(value);
      setResultPath(path);
      reload();
    };
    patchListeners.add(notify);
    return () => patchListeners.delete(notify);
  }, [path, enabled, swr, reload]);

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

    const forced = fetchedNonce.current !== nonce;
    fetchedNonce.current = nonce;
    const startedAt = performance.now();
    requestWithRetry(path, { join: !forced, isCurrent: () => live,
      onRetry: (err, attempt) => logger.debug('api.retry', { resource: label || path, attempt, status: err?.status ?? null }) })
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
        if (swr && isNewestGeneration(path, myGeneration)) { cacheSet(path, result); fetchedAt.set(path, Date.now()); }
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
  // With swr, a key change that the cache already holds paints that key's
  // own snapshot in the SAME render instead of one empty frame first — the
  // flash a day flip used to show before the effect copied the cache over.
  const matches = resultPath === path;
  if (!matches && swr && enabled && path && swrCache.has(path)) {
    return { data: swrCache.get(path), resourceKey: path, loading: false, error: null, revalidating: true, reload };
  }
  return { data: matches ? data : null, resourceKey: path,
    loading: matches ? loading : Boolean(enabled && path),
    error: matches ? error : null, revalidating: matches && revalidating, reload };
}

export default useApiResource;
