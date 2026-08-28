// useMenuNavigationContext.js — consumer hooks for MenuNavigationContext.jsx,
// split out so Fast Refresh can hot-reload files that only export components.
import { useContext } from 'react';
import { MenuNavigationContext } from './MenuNavigationContext.jsx';

/**
 * Hook to access navigation context
 * @returns {Object} Navigation context value
 * @throws {Error} If used outside of MenuNavigationProvider
 */
export function useMenuNavigationContext() {
  const context = useContext(MenuNavigationContext);
  if (!context) {
    throw new Error('useMenuNavigationContext must be used within MenuNavigationProvider');
  }
  return context;
}

/**
 * Hook to check if we're within a MenuNavigationProvider
 * (useful for components that can work with or without the provider)
 * @returns {boolean}
 */
export function useHasMenuNavigationContext() {
  const context = useContext(MenuNavigationContext);
  return context !== null;
}
