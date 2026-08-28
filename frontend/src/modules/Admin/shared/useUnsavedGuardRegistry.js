// useUnsavedGuardRegistry.js — the registry accessor for
// UnsavedGuardContext.jsx, split out so Fast Refresh can hot-reload files
// that only export components.
import { useContext } from 'react';
import { UnsavedGuardContext } from './UnsavedGuardContext.jsx';

/**
 * Access the guard registry. Returns null outside a provider so consumers
 * (hook, nav) can degrade gracefully in isolated renders/tests.
 */
export function useUnsavedGuardRegistry() {
  return useContext(UnsavedGuardContext);
}
