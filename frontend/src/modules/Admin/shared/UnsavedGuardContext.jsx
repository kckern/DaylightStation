import React, { createContext, useContext, useRef, useCallback, useMemo } from 'react';

/**
 * UnsavedGuardContext — registry of dirty flags for admin editors.
 *
 * Editors register their dirty state via useUnsavedGuard(); navigation chrome
 * (AdminNav) asks isAnyDirty() at click time to decide whether to intercept.
 *
 * The registry lives in a ref (no re-render on updates — consumers only need
 * a point-in-time answer when the user tries to navigate).
 */
const UnsavedGuardContext = createContext(null);

export function UnsavedGuardProvider({ children }) {
  const registryRef = useRef(new Map());

  const register = useCallback((id, dirty) => {
    registryRef.current.set(id, Boolean(dirty));
  }, []);

  const unregister = useCallback((id) => {
    registryRef.current.delete(id);
  }, []);

  const isAnyDirty = useCallback(() => {
    for (const dirty of registryRef.current.values()) {
      if (dirty) return true;
    }
    return false;
  }, []);

  const value = useMemo(
    () => ({ register, unregister, isAnyDirty }),
    [register, unregister, isAnyDirty]
  );

  return (
    <UnsavedGuardContext.Provider value={value}>
      {children}
    </UnsavedGuardContext.Provider>
  );
}

/**
 * Access the guard registry. Returns null outside a provider so consumers
 * (hook, nav) can degrade gracefully in isolated renders/tests.
 */
export function useUnsavedGuardRegistry() {
  return useContext(UnsavedGuardContext);
}

export default UnsavedGuardContext;
