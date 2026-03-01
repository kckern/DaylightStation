import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const ScreenDataContext = createContext({});

/**
 * ScreenDataProvider - Fetches declared data sources once, refreshes on interval,
 * distributes via context. Two widgets referencing the same key share one fetch.
 *
 * @param {Object} props.sources - { [key]: { source: string, refresh: number (seconds) } }
 */
export function ScreenDataProvider({ sources = {}, children }) {
  const [store, setStore] = useState({});
  const intervalsRef = useRef([]);

  useEffect(() => {
    const entries = Object.entries(sources);
    if (entries.length === 0) return;

    const fetchSource = async (key, url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        setStore(prev => ({ ...prev, [key]: data }));
      } catch {
        // silent — widget shows its own loading/error state
      }
    };

    // Initial fetch for all sources
    entries.forEach(([key, { source }]) => fetchSource(key, source));

    // Set up refresh intervals
    const ids = entries
      .filter(([, { refresh }]) => refresh)
      .map(([key, { source, refresh }]) =>
        setInterval(() => fetchSource(key, source), refresh * 1000)
      );
    intervalsRef.current = ids;

    return () => ids.forEach(clearInterval);
  }, [sources]);

  return (
    <ScreenDataContext.Provider value={store}>
      {children}
    </ScreenDataContext.Provider>
  );
}

/**
 * useScreenData - Consume a coordinated data source by key.
 * Returns the fetched data or null if not yet available.
 */
export function useScreenData(key) {
  const store = useContext(ScreenDataContext);
  return store[key] ?? null;
}
