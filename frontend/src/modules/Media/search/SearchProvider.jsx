import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

export const SCOPE_KEY_LAST = 'media-scope-last';

const SearchContext = createContext(null);

export function SearchProvider({ children }) {
  const [scopes, setScopes] = useState([]);
  const [currentScopeKey, setCurrentScopeKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/media/config').then((cfg) => {
      if (cancelled) return;
      const loaded = Array.isArray(cfg?.searchScopes) ? cfg.searchScopes : [];
      setScopes(loaded);
      const stored = localStorage.getItem(SCOPE_KEY_LAST);
      const storedValid = stored && loaded.find((s) => s.key === stored);
      setCurrentScopeKey(storedValid ? stored : loaded[0]?.key ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setScopeKey = useCallback((key) => {
    setCurrentScopeKey(key);
    try { localStorage.setItem(SCOPE_KEY_LAST, key); } catch { /* ignore */ }
  }, []);

  const currentScope = useMemo(
    () => scopes.find((s) => s.key === currentScopeKey) ?? null,
    [scopes, currentScopeKey]
  );

  const value = useMemo(
    () => ({ scopes, currentScopeKey, currentScope, setScopeKey }),
    [scopes, currentScopeKey, currentScope, setScopeKey]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used inside SearchProvider');
  return ctx;
}

export default SearchProvider;
