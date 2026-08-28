import { useContext } from 'react';
import { ScreenContext } from './ScreenProvider.jsx';

/**
 * Hook to access the screen layout context.
 * Returns { replace, restore, getNode } plus config references.
 */
export function useScreen() {
  const ctx = useContext(ScreenContext);
  if (!ctx) {
    throw new Error('useScreen() must be used within a <ScreenProvider>');
  }
  return {
    replace: ctx.replace,
    restore: ctx.restore,
    getNode: ctx.getNode,
    mergedConfig: ctx.mergedConfig,
    originalConfig: ctx.originalConfig,
  };
}
