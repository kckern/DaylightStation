//
// The house { data, loading, error, reload } fetch hook — promoted from
// __app_modules/Auto/useAutoApi.js (same semantics: a request whose component
// unmounted mid-flight is discarded rather than written to state).
//
// Opt-in stale-while-revalidate (`swr: true`): a module-level cache keyed by
// `path` holds the last successful payload. A cache hit on mount (or on any
// later re-run of the fetch effect — path change, `reload()`) serves the
// cached value immediately with `loading: false`, while a `revalidating` flag
// reports that a background refresh is in flight. Requests at the same path
// share in-flight work by default. A non-SWR reader that remounts per account
// can pass `dedupe: false` to issue independent requests. SWR entries still
// use the path as their cache key.
//
// One cacheable read owns the next outcome for a path. Joined readers and
// prefetch share that read. It publishes once to the cache and to every
// enabled SWR reader of that path. Each hook still owns its refresh waiter
// and disposes it when the hook changes scope or its read is superseded.
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

const activeCacheReads = new Map();
const cacheReaders = new Map();
const refreshListeners = new Set();

function retireCachedRead(path) {
  const read = activeCacheReads.get(path);
  if (!read) return false;
  activeCacheReads.delete(path);
  if (!read.prefetch?.()) read.release();
  return true;
}

function publishToReaders(path, kind, value) {
  for (const reader of cacheReaders.get(path) ?? []) reader.notify(kind, value);
}

/** Revalidate mounted readers together without blanking same-key snapshots. */
export function invalidateApiResources(matches = () => true) {
  // Cached-but-unmounted entries (prefetched neighbours) become stale too:
  // they keep painting instantly, and the next prefetch pass refreshes them.
  for (const [path, entry] of swrCache) {
    if (entry.fetchedAt != null && matches(path)) entry.fetchedAt = null;
  }
  for (const path of inFlight.keys()) if (matches(path)) inFlight.delete(path);
  // The cache read can outlive its first transport, including during retry.
  for (const path of activeCacheReads.keys()) if (matches(path)) retireCachedRead(path);
  for (const notify of refreshListeners) notify(matches);
}

/** Poll matching mounted readers without invalidating cached or outstanding reads. */
export function pollApiResources(matches = () => true) {
  for (const notify of refreshListeners) notify(matches, true);
}

function cacheGet(path) {
  const entry = swrCache.get(path);
  if (!entry) return { hit: false };
  // Touch for recency: delete+set moves this key to the end of Map's
  // insertion-ordered iteration, which is what the LRU eviction below reads.
  swrCache.delete(path);
  swrCache.set(path, entry);
  return { hit: true, value: entry.value };
}

function cacheSet(path, value, { persist = true, fetchedAt = Date.now() } = {}) {
  swrCache.delete(path);
  swrCache.set(path, { value, fetchedAt });
  if (persist) schedulePersist(path, value);
  if (swrCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = swrCache.keys().next().value;
    swrCache.delete(oldestKey);
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
    }
    for (const path of inFlight.keys()) if (scope.matches(path)) inFlight.delete(path);
    retirePrefetches(scope.matches);
    for (const path of activeCacheReads.keys()) if (scope.matches(path)) retireCachedRead(path);
    if (prefetchBatch) prefetchBatch.queue = prefetchBatch.queue.filter(path => !scope.matches(path));
    if (isPrefetchIdle()) discardPrefetchBatch();
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
        cacheSet(path, value, { persist: false, fetchedAt: null });
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
const inFlight = new Map(); // path -> physical request and its admission metadata

function issueRequest(path) {
  const issuedEvent = nextApiResourceEvent();
  const issuedAt = Date.now();
  const scope = registrationFor(path);
  const controller = new AbortController();
  const { signal } = controller;
  let interests = 0;
  let settled = false;
  const request = new Promise(resolve => resolve(DaylightAPI(path, {}, 'GET', { signal }))).then(result => {
    if (signal.aborted) throw new DOMException('Resource GET cancelled', 'AbortError');
    if (result && typeof result === 'object') networkStarts.set(result, issuedEvent);
    return result;
  });
  const forget = () => { if (inFlight.get(path) === transport) inFlight.delete(path); };
  function retain() {
    interests++;
    return () => {
      interests--;
      if (interests || settled) return;
      // React can replace observers in one commit, and an adjacent prefetch
      // can claim the same GET. Release it after those synchronous changes.
      queueMicrotask(() => {
        if (interests || settled) return;
        forget();
        controller.abort();
      });
    };
  }
  const transport = { request, issuedAt, issuedEvent, scope, cacheRead: null, retain };
  const settle = () => { settled = true; forget(); };
  request.then(settle, settle);
  return transport;
}

function createRequestLease() {
  let release;
  return {
    take(transport) {
      release?.();
      release = transport.retain();
      return transport.request;
    },
    dispose() {
      release?.();
      release = undefined;
    },
  };
}

function sharedRequest(path, { join = true, dedupe = true, canJoin } = {}) {
  if (!dedupe) return issueRequest(path);
  const current = inFlight.get(path);
  const scope = registrationFor(path);
  if (join && current && current.scope === scope && Date.now() - current.issuedAt < JOIN_WINDOW_MS
    && (!canJoin || canJoin(current))) return current;
  const read = issueRequest(path);
  inFlight.set(path, read);
  return read;
}

// ---- Transient retry -----------------------------------------------------------
// A proxy's 502/503/504 or a dropped connection (api.mjs marks these
// `transient`) is almost always the backend restarting: the same GET asked
// again seconds later succeeds. A reader asks again on this schedule before
// it reports anything, and stops as soon as it is no longer current.
export const TRANSIENT_RETRY_DELAYS_MS = [1000, 3000];

function requestWithRetry(getRequest, { join, isCurrent, onRetry }) {
  const attempt = (index, joinThis) => getRequest(joinThis, index).catch(err => {
    const delay = TRANSIENT_RETRY_DELAYS_MS[index];
    if (!err?.transient || delay === undefined || !isCurrent()) throw err;
    onRetry?.(err, index + 1);
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

function readCachedResource(path, { join, dedupe, attach, prefetch, onRetry } = {}) {
  const latest = activeCacheReads.get(path);
  const first = sharedRequest(path, { join, dedupe, canJoin: candidate => candidate.cacheRead
    ? candidate.cacheRead === latest : !latest || candidate.issuedEvent >= latest.issuedEvent });
  if (first.cacheRead) {
    if (prefetch) first.cacheRead.prefetch = prefetch;
    attach?.(first.cacheRead);
    return first.cacheRead;
  }
  // An independent cacheable read supersedes an earlier shareable transport.
  if (dedupe === false) inFlight.delete(path);
  const { scope, issuedEvent } = first;
  const epoch = scope?.epoch;
  const lease = createRequestLease();
  let transport = first;
  const read = {
    issuedEvent, prefetch, accepted: false, promise: null,
    release() {
      if (transport.cacheRead === read) transport.cacheRead = null;
      lease.dispose();
    },
  };
  retireCachedRead(path);
  activeCacheReads.set(path, read);
  first.cacheRead = read;
  attach?.(read);
  publishToReaders(path, 'start', read);

  const ownsPath = () => activeCacheReads.get(path) === read && scope === registrationFor(path) && scope?.epoch === epoch;
  const hasInterest = () => cacheReaders.has(path) || read.prefetch?.();
  const canRetry = () => ownsPath() && [...(cacheReaders.get(path) ?? [])].some(reader => reader.retryTransient);
  const getRequest = (joinAttempt, index) => {
    if (index !== 0) transport = sharedRequest(path, { join: joinAttempt, dedupe });
    transport.cacheRead = read;
    return lease.take(transport);
  };
  const publish = (kind, value) => {
    if (!ownsPath() || !hasInterest()) return;
    read.accepted = true;
    if (kind === 'success') cacheSet(path, value);
    publishToReaders(path, kind, value);
  };
  read.promise = requestWithRetry(getRequest, { join, isCurrent: canRetry, onRetry }).then(result => {
    publish('success', result);
    return result;
  }, error => {
    publish('failure', error);
    throw error;
  }).finally(() => {
    read.release();
    if (activeCacheReads.get(path) === read) activeCacheReads.delete(path);
  });
  return read;
}

// ---- Prefetch --------------------------------------------------------------
// Fills the same swr cache ahead of a reader, so a view that mounts on that
// path paints instantly (and still revalidates quietly, as every swr hit
// does). Low priority by construction: a small concurrency cap, queued work
// is replaceable wholesale when the user moves, and a response only writes the
// cache if no newer request for that path was issued meanwhile.
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_FRESH_MS = 60_000;
let prefetchBatch = null;
const prefetchInFlight = new Map();

function retirePrefetches(matches) {
  for (const [path, task] of prefetchInFlight) {
    if (!matches(path)) continue;
    prefetchInFlight.delete(path);
    task.read.release();
  }
}

// Cumulative since page load (or the last reset): what the prefetcher was
// asked to warm, and how it went. Read by callers that report on it.
const prefetchStats = { queued: 0, completed: 0, failed: 0 };

function discardPrefetchBatch() {
  const batch = prefetchBatch;
  prefetchBatch = null;
  batch?.signal?.removeEventListener('abort', batch.cancel);
}

function finishPrefetchBatch() {
  if (!isPrefetchIdle()) return;
  const onIdle = prefetchBatch?.onIdle;
  discardPrefetchBatch();
  onIdle?.(getPrefetchStats());
}

function pumpPrefetch() {
  while (prefetchInFlight.size < PREFETCH_CONCURRENCY && prefetchBatch?.queue.length) {
    const { queue, onDone, signal } = prefetchBatch;
    const path = queue.shift();
    const task = {};
    prefetchInFlight.set(path, task);
    const isCurrent = () => prefetchInFlight.get(path) === task;
    task.read = readCachedResource(path, { prefetch: isCurrent });
    task.read.promise
      .then(() => {
        if (!isCurrent()) return;
        prefetchStats.completed += 1;
        if (!signal?.aborted) onDone?.(null, path);
      })
      .catch(err => {
        if (!isCurrent()) return;
        prefetchStats.failed += 1;
        if (!signal?.aborted) onDone?.(err, path);
      })
      .finally(() => {
        if (!isCurrent()) return;
        prefetchInFlight.delete(path);
        pumpPrefetch();
        finishPrefetchBatch();
      });
  }
}

/** Prefetch counters since load: `{ queued, completed, failed }` (a copy). */
export function getPrefetchStats() {
  return { ...prefetchStats };
}

/** True when nothing is queued or in flight. */
export function isPrefetchIdle() {
  return prefetchInFlight.size === 0 && !prefetchBatch?.queue.length;
}

/** True when the swr cache holds a payload for `path` fetched recently. */
export function isApiResourceFresh(path, maxAgeMs = PREFETCH_FRESH_MS) {
  const fetchedAt = swrCache.get(path)?.fetchedAt;
  return fetchedAt != null && Date.now() - fetchedAt < maxAgeMs;
}

/** The cached payload for `path`, or undefined. Does not touch recency. */
export function peekApiResource(path) {
  return swrCache.get(path)?.value;
}

/** Write a payload fetched outside the hook (same freshness bookkeeping). */
export function primeApiResource(path, value) {
  cacheSet(path, value);
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
 * Returns false when nothing has loaded the path yet. With `create: true`,
 * `update(undefined)` can publish the first value using the same read guards.
 */
export function patchApiResource(path, update, { create = false } = {}) {
  const cached = swrCache.get(path);
  if (!cached && !create) return false;
  const next = update(cached?.value);
  if (next === undefined) return false;
  inFlight.delete(path);
  retireCachedRead(path);
  cacheSet(path, next, { fetchedAt: cached?.fetchedAt });
  publishToReaders(path, 'patch', next);
  return true;
}

/**
 * Replace the prefetch queue with `paths`, in priority order. Paths already
 * fresh in the cache are skipped. The signal drops this batch's queued work
 * and callbacks on abort. Admitted reads can finish and warm the cache.
 * The latest active batch's `onIdle(stats)` runs once when all work drains.
 */
export function prefetchApiResources(paths, { onDone, onIdle, signal } = {}) {
  if (signal?.aborted) return 0;
  discardPrefetchBatch();
  const queue = [...new Set(paths)].filter(path => path && !isApiResourceFresh(path) && !prefetchInFlight.has(path));
  const batch = {
    queue, onDone, onIdle: typeof onIdle === 'function' ? onIdle : null, signal,
    cancel: () => { if (prefetchBatch === batch) discardPrefetchBatch(); },
  };
  prefetchBatch = batch;
  signal?.addEventListener('abort', batch.cancel, { once: true });
  const accepted = queue.length;
  prefetchStats.queued += accepted;
  pumpPrefetch();
  // Nothing to fetch and nothing in flight: this call's neighbourhood is
  // already warm, so report now (with the caller's own context) rather than
  // leave the callback waiting for a drain that will not come.
  finishPrefetchBatch();
  return accepted;
}

// A path reset drops that snapshot from memory and persistent storage. Use
// invalidateApiResources to revalidate mounted readers. The no-argument reset
// is for tests and clears memory only, leaving attached stores intact.
export function resetApiResourceCache(path) {
  if (path === undefined) {
    swrCache.clear();
    retirePrefetches(() => true);
    for (const key of activeCacheReads.keys()) retireCachedRead(key);
    inFlight.clear();
    for (const scope of registrations) scope.pending.clear();
    discardPrefetchBatch();
    Object.assign(prefetchStats, { queued: 0, completed: 0, failed: 0 });
    return;
  }
  swrCache.delete(path);
  if (retireCachedRead(path)) publishToReaders(path, 'reset');
  inFlight.delete(path);
  schedulePersist(path, undefined);
}

function refreshAbortError() {
  const error = new Error('Resource refresh was superseded before it completed');
  error.name = 'AbortError';
  return error;
}

export function useApiResource(path, {
  deps = [], enabled = true, label, logger = defaultLogger,
  swr = false, dedupe = true, retryTransient = true, clearDataOnError = false,
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
      || (swr && activeCacheReads.has(path))
      || fetchedReload.current !== requestedReload.current) return;
    requestReload(null, true);
  }, [path, requestReload, swr]);

  useEffect(() => {
    activePath.current = enabled ? path : null;
    const notify = (matches, pollOnly) => {
      if (!enabled || !path || !matches(path)) return;
      if (pollOnly) poll();
      else requestReload(null, true);
    };
    const clearOwner = matches => {
      if (!path || !matches(path)) return;
      setData(null);
      setError(null);
      if (enabled) requestReload(null, true);
    };
    refreshListeners.add(notify);
    ownerListeners.add(clearOwner);
    return () => {
      activePath.current = null;
      cancelRefresh();
      refreshListeners.delete(notify);
      ownerListeners.delete(clearOwner);
    };
  }, [path, enabled, requestReload, cancelRefresh, poll]);

  // Cached snapshots and their outcomes are shared by enabled readers. An
  // observer still owns its own awaitable refresh and error clearing policy.
  useEffect(() => {
    if (!swr || !enabled || !path) return undefined;
    const reader = { retryTransient, notify: (kind, value) => {
      if (kind === 'reset') {
        activeRead.current?.supersede(null);
        setLoading(false);
        setRevalidating(false);
        return;
      }
      if (kind === 'start') {
        activeRead.current?.supersede(value);
        const cached = swrCache.get(path);
        if (cached) {
          setData(cached.value);
          setResultPath(path);
        }
        setError(null);
        setLoading(!cached);
        setRevalidating(Boolean(cached));
        return;
      }
      if (kind !== 'failure') {
        setData(value);
        setResultPath(path);
      } else if (clearDataOnError) setData(null);
      if (kind === 'patch') {
        requestReload(null, true);
        return;
      }
      setError(kind === 'failure' ? value : null);
      setLoading(false);
      setRevalidating(false);
    } };
    const readers = cacheReaders.get(path) ?? new Set();
    readers.add(reader);
    cacheReaders.set(path, readers);
    return () => {
      readers.delete(reader);
      if (readers.size) return;
      cacheReaders.delete(path);
      queueMicrotask(() => {
        const read = activeCacheReads.get(path);
        if (!cacheReaders.has(path) && read && !read.prefetch?.()) retireCachedRead(path);
      });
    };
  }, [path, enabled, swr, requestReload, clearDataOnError, retryTransient]);

  useEffect(() => {
    const takeRefresh = () => {
      const pending = pendingRefresh.current;
      if (!pending || pending.request !== reloadRequest) return null;
      pendingRefresh.current = null;
      return pending;
    };
    if (!enabled || !path) { setLoading(false); return undefined; }
    let live = true;
    const lease = swr ? null : createRequestLease();
    const scope = registrationFor(path);
    const epoch = scope?.epoch;
    const isCurrent = () => live && reloadRequest === requestedReload.current &&
      scope === registrationFor(path) && scope?.epoch === epoch;
    const releaseRead = () => {
      if (activeRead.current === readState) activeRead.current = null;
    };
    const retireRead = () => {
      live = false;
      lease?.dispose();
      releaseRead();
      takeRefresh()?.reject(refreshAbortError());
    };
    const readState = {
      cacheRead: null,
      supersede(next) {
        if (readState.cacheRead && readState.cacheRead !== next) retireRead();
      },
    };
    activeRead.current = readState;

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

    const join = fetchedReload.current === reloadRequest || reloadRequest?.join;
    fetchedReload.current = reloadRequest;
    const startedAt = performance.now();
    const onRetry = (err, attempt) => logger.debug('api.retry', { resource: label || path, attempt, status: err?.status ?? null });
    const getRequest = joinAttempt => lease.take(sharedRequest(path, { join: joinAttempt, dedupe }));
    const cacheRead = swr ? readCachedResource(path, {
      join, dedupe, onRetry, attach: read => { readState.cacheRead = read; },
    }) : null;
    const request = cacheRead?.promise ?? (retryTransient
      ? requestWithRetry(getRequest, { join, isCurrent, onRetry })
      : getRequest(join));
    request
      .then((result) => {
        if (!isCurrent()) return;
        if (cacheRead && !cacheRead.accepted) { retireRead(); return; }
        if (!cacheRead) {
          setData(result);
          setResultPath(path);
          setLoading(false);
        }
        takeRefresh()?.resolve(result);
        logger.debug(cacheHit ? 'api.revalidated' : 'api.loaded', { resource: label || path, ms: Math.round(performance.now() - startedAt) });
      })
      .catch((err) => {
        if (!isCurrent()) return;
        if (cacheRead && !cacheRead.accepted) { retireRead(); return; }
        if (!cacheRead) {
          if (clearDataOnError) setData(null);
          setError(err);
          setLoading(false);
        }
        takeRefresh()?.reject(err);
        logger.warn('api.failed', { resource: label || path, error: err?.message });
      })
      .finally(() => {
        lease?.dispose();
        releaseRead();
      });

    return retireRead;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, reloadRequest, swr, dedupe, retryTransient, clearDataOnError, ...deps]);

  // Effects run after render: conceal the previous key synchronously, not
  // just after the new request starts, so stale rows are never actionable.
  // With swr, a key change that the cache already holds paints that key's
  // own snapshot in the SAME render instead of one empty frame first — the
  // flash a day flip used to show before the effect copied the cache over.
  const matches = resultPath === path;
  if (!matches && swr && enabled && path && swrCache.has(path)) {
    return { data: peekApiResource(path), resourceKey: path, loading: false, error: null, revalidating: true, reload, refresh, poll };
  }
  return { data: matches ? data : null, resourceKey: path,
    loading: matches ? loading : Boolean(enabled && path),
    error: matches ? error : null, revalidating: matches && revalidating, reload, refresh, poll };
}

export default useApiResource;
