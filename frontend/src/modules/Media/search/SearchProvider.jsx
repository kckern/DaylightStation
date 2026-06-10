// frontend/src/modules/Media/search/SearchProvider.jsx
// Loads search scopes from the household media config, flattens parents +
// children into one lookup tree, tracks and persists the current scope.
// See docs/reference/media/search-scopes.md.
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { STORAGE_KEYS } from '../constants.js';

export const SCOPE_KEY_LAST = STORAGE_KEYS.SCOPE_LAST;

const SearchContext = createContext(null);

export function SearchProvider({ children }) {
  const [scopes, setScopes] = useState([]);
  const [currentScopeKey, setCurrentScopeKey] = useState(null);
  const [scopeError, setScopeError] = useState(null);

  // Flatten parent scopes + their children so a stored child key resolves and
  // currentScope can search the whole tree, not just the top level.
  const flatScopes = useMemo(
    () => scopes.flatMap((s) => [s, ...(Array.isArray(s.children) ? s.children : [])]),
    [scopes]
  );

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/media/config').then((cfg) => {
      if (cancelled) return;
      const loaded = Array.isArray(cfg?.searchScopes) ? cfg.searchScopes : [];
      setScopes(loaded);
      const flat = loaded.flatMap((s) => [s, ...(Array.isArray(s.children) ? s.children : [])]);
      const stored = localStorage.getItem(SCOPE_KEY_LAST);
      const storedValid = stored && flat.find((s) => s.key === stored);
      setCurrentScopeKey(storedValid ? stored : loaded[0]?.key ?? null);
    }).catch((err) => { if (!cancelled) setScopeError(err); });
    return () => { cancelled = true; };
  }, []);

  const setScopeKey = useCallback((key) => {
    setCurrentScopeKey(key);
    try { localStorage.setItem(SCOPE_KEY_LAST, key); } catch { /* ignore */ }
  }, []);

  const currentScope = useMemo(
    () => flatScopes.find((s) => s.key === currentScopeKey) ?? null,
    [flatScopes, currentScopeKey]
  );

  const value = useMemo(
    () => ({ scopes, currentScopeKey, currentScope, scopeError, setScopeKey }),
    [scopes, currentScopeKey, currentScope, scopeError, setScopeKey]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used inside SearchProvider');
  return ctx;
}

export default SearchProvider;
