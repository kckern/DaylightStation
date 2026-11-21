// frontend/src/modules/Media/search/SearchProvider.jsx
// Loads search scopes from the household media config, flattens parents +
// children into one lookup tree, tracks the current scope for this session
// only. Scope is never persisted: every mount (and every resetScope() call)
// starts catalog-wide, at the first configured scope.
// See __docs/reference/media/search-scopes.md.
import React, { createContext, useMemo, useState, useCallback } from 'react';
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

const EMPTY_SCOPES = [];

export const SearchContext = createContext(null);

export function SearchProvider({ children }) {
  const { data, error: scopeError, reload: retryScopes } = useApiResource('api/v1/media/config', { label: 'Media search scopes' });
  const scopes = Array.isArray(data?.searchScopes) ? data.searchScopes : EMPTY_SCOPES;
  const [selected, setScopeKey] = useState();
  const currentScopeKey = selected === undefined ? scopes[0]?.key ?? null : selected;
  const resetScope = useCallback(() => setScopeKey(undefined), []);

  // Flatten parent scopes + their children so a child key resolves and
  // currentScope can search the whole tree, not just the top level.
  const flatScopes = useMemo(
    () => scopes.flatMap((s) => [s, ...(Array.isArray(s.children) ? s.children : [])]),
    [scopes]
  );

  const currentScope = useMemo(
    () => flatScopes.find((s) => s.key === currentScopeKey) ?? null,
    [flatScopes, currentScopeKey]
  );

  const value = useMemo(
    () => ({ scopes, currentScopeKey, currentScope, scopeError, retryScopes, setScopeKey, resetScope }),
    [scopes, currentScopeKey, currentScope, scopeError, retryScopes, setScopeKey, resetScope]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export default SearchProvider;
