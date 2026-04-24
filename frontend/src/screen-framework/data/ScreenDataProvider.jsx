import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenDataProvider' });
  return _logger;
}

const ScreenDataContext = createContext({});
const ScreenDataActionsContext = createContext({ refetch: async () => {} });

/**
 * ScreenDataProvider - Fetches declared data sources once, refreshes on interval,
 * distributes via context. Exposes imperative `refetch(key)` via
 * useScreenDataRefetch() for cache invalidation after mutations.
 */
export function ScreenDataProvider({ sources = {}, children }) {
  const [store, setStore] = useState({});
  const intervalsRef = useRef([]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const fetchSource = useCallback(async (key, url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setStore(prev => ({ ...prev, [key]: data }));
    } catch (err) {
      logger().warn('screendataprovider.fetch-failed', { key, url, error: err.message });
    }
  }, []);

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

  return (
    <ScreenDataContext.Provider value={store}>
      <ScreenDataActionsContext.Provider value={actions}>
        {children}
      </ScreenDataActionsContext.Provider>
    </ScreenDataContext.Provider>
  );
}

export function useScreenData(key) {
  const store = useContext(ScreenDataContext);
  return store[key] ?? null;
}

export function useScreenDataRefetch() {
  const { refetch } = useContext(ScreenDataActionsContext);
  return refetch;
}
