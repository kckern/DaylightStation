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

// A cached payload is only trusted for the exact URL it was fetched from, so a
// source whose query changes (e.g. a new `since=` window) never shows the old shape.
function readCache(persistKey, key, url) {
  try {
    const raw = localStorage.getItem(cacheStorageKey(persistKey, key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || entry.url !== url || entry.data === undefined) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(persistKey, key, url, data) {
  try {
    localStorage.setItem(
      cacheStorageKey(persistKey, key),
      JSON.stringify({ url, savedAt: Date.now(), data }),
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
 * @param {{ current: any }} [props.actionsRef] - Receives `{ refetch }` while mounted,
 *   for callers outside this subtree (e.g. an overlay rendered beside the screen).
 */
export function ScreenDataProvider({ sources = {}, persistKey, persist, actionsRef, children }) {
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
      const entry = url ? readCache(persistKey, key, url) : null;
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
      if (persistSet.has(key)) writeCache(persistKey, key, url, data);
    } catch (err) {
      logger().warn('screendataprovider.fetch-failed', { key, url, error: err.message });
    }
  }, [persistKey, persistSet]);

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
