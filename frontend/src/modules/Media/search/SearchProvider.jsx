// frontend/src/modules/Media/search/SearchProvider.jsx
// Loads search scopes from the household media config, flattens parents +
// children into one lookup tree, tracks the current scope for this session
// only. Scope is never persisted: every mount (and every resetScope() call)
// starts catalog-wide, at the first configured scope.
// See docs/reference/media/search-scopes.md.
import React, { createContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

export const SearchContext = createContext(null);

export function SearchProvider({ children }) {
  const [scopes, setScopes] = useState([]);
  const [currentScopeKey, setCurrentScopeKey] = useState(null);
  const [scopeError, setScopeError] = useState(null);
  const scopesRef = useRef([]);

  // Flatten parent scopes + their children so a child key resolves and
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
      scopesRef.current = loaded;
      setCurrentScopeKey(loaded[0]?.key ?? null);
    }).catch((err) => { if (!cancelled) setScopeError(err); });
    return () => { cancelled = true; };
  }, []);

  const setScopeKey = useCallback((key) => {
    setCurrentScopeKey(key);
  }, []);

  // Returns to the catalog-wide default — the first scope in the loaded
  // config, not a hardcoded string, since the tree is household config.
  const resetScope = useCallback(() => {
    setCurrentScopeKey(scopesRef.current[0]?.key ?? null);
  }, []);

  const currentScope = useMemo(
    () => flatScopes.find((s) => s.key === currentScopeKey) ?? null,
    [flatScopes, currentScopeKey]
  );

  const value = useMemo(
    () => ({ scopes, currentScopeKey, currentScope, scopeError, setScopeKey, resetScope }),
    [scopes, currentScopeKey, currentScope, scopeError, setScopeKey, resetScope]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export default SearchProvider;
