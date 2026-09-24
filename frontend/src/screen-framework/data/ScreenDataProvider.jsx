import React, { createContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenDataProvider' });
  return _logger;
}

export const ScreenDataContext = createContext({});
export const ScreenDataActionsContext = createContext({ refetch: async () => {} });

const CACHE_PREFIX = 'screenData';

function cacheStorageKey(persistKey, key) {
  return `${CACHE_PREFIX}:${persistKey}:${key}`;
}

// Changes once per build (vite.config.js defines it). A cached payload from an
// older bundle may have an older response shape, so it is never trusted — the
// first load after a deploy is an ordinary cold load, and it rewrites the entry.
const DEFAULT_CACHE_VERSION = import.meta.env?.VITE_BUILD_ID || 'dev';

// A cached payload is only trusted for the exact URL AND build it was written
// by. The version lives inside the entry, not the key, so each source keeps a
// single entry instead of one orphaned ~300 KB copy per deploy.
function readCache(persistKey, key, url, version) {
  try {
    const raw = localStorage.getItem(cacheStorageKey(persistKey, key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || entry.url !== url || entry.version !== version || entry.data === undefined) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(persistKey, key, url, version, data) {
  try {
    localStorage.setItem(
      cacheStorageKey(persistKey, key),
      JSON.stringify({ url, version, savedAt: Date.now(), data }),
    );
  } catch (err) {
    logger().warn('screendataprovider.cache-write-failed', { key, error: err?.message });
  }
}

/**
 * ScreenDataProvider - Fetches declared data sources once, refreshes on interval,
 * distributes via context. Exposes imperative `refetch(key)` via
 * useScreenDataRefetch() for cache invalidation after mutations.
 *
 * @param {string} [props.persistKey] - Namespace for the localStorage cache.
 * @param {string[]} [props.persist] - Source keys to cache stale-while-revalidate:
 *   the last payload renders on the first frame, the fetch still runs and replaces it.
 * @param {string} [props.cacheVersion] - Cache entries from any other version are
 *   ignored. Defaults to the build id, so a deploy never renders an old-shape payload.
 * @param {{ current: any }} [props.actionsRef] - Receives `{ refetch }` while mounted,
 *   for callers outside this subtree (e.g. an overlay rendered beside the screen).
 */
export function ScreenDataProvider({ sources = {}, persistKey, persist, cacheVersion = DEFAULT_CACHE_VERSION, actionsRef, children }) {
  const persistSet = useMemo(
    () => new Set(persistKey && Array.isArray(persist) ? persist : []),
    // Joined so a fresh array literal each render doesn't churn the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persistKey, (persist || []).join('|')],
  );
  const [store, setStore] = useState(() => {
    const initial = {};
    for (const key of persistSet) {
      const url = sources[key]?.source;
      const entry = url ? readCache(persistKey, key, url, cacheVersion) : null;
      if (!entry) continue;
      initial[key] = entry.data;
      logger().info('screendataprovider.cache-hydrated', {
        persistKey, key, ageMs: Date.now() - (entry.savedAt || 0),
      });
    }
    return initial;
  });
  const intervalsRef = useRef([]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const fetchSource = useCallback(async (key, url) => {
    const startedAt = performance.now();
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setStore(prev => ({ ...prev, [key]: data }));
      logger().sampled('screendataprovider.fetched', {
        key, ms: Math.round(performance.now() - startedAt),
      }, { maxPerMinute: 20, aggregate: true });
      if (persistSet.has(key)) writeCache(persistKey, key, url, cacheVersion, data);
    } catch (err) {
      logger().warn('screendataprovider.fetch-failed', { key, url, error: err.message });
    }
  }, [persistKey, persistSet, cacheVersion]);

  useEffect(() => {
    const entries = Object.entries(sources);
    if (entries.length === 0) return;
    entries.forEach(([key, { source }]) => fetchSource(key, source));
    const ids = entries
      .filter(([, { refresh }]) => refresh)
      .map(([key, { source, refresh }]) =>
        setInterval(() => fetchSource(key, source), refresh * 1000)
      );
    intervalsRef.current = ids;
    return () => ids.forEach(clearInterval);
  }, [sources, fetchSource]);

  const refetch = useCallback(async (key) => {
    const entry = sourcesRef.current?.[key];
    if (!entry?.source) return;
    await fetchSource(key, entry.source);
  }, [fetchSource]);

  const actions = useMemo(() => ({ refetch }), [refetch]);

  useEffect(() => {
    if (!actionsRef) return undefined;
    actionsRef.current = actions;
    return () => {
      if (actionsRef.current === actions) actionsRef.current = null;
    };
  }, [actionsRef, actions]);

  return (
    <ScreenDataContext.Provider value={store}>
      <ScreenDataActionsContext.Provider value={actions}>
        {children}
      </ScreenDataActionsContext.Provider>
    </ScreenDataContext.Provider>
  );
}
