// useSearchContext.js — the hook half of SearchProvider.jsx, split out so
// Fast Refresh can hot-reload the provider component on its own.
import { useContext } from 'react';
import { SearchContext } from './SearchProvider.jsx';

export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used inside SearchProvider');
  return ctx;
}
