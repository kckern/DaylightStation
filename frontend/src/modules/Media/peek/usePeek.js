// usePeek.js — the hook half of PeekProvider.jsx, split out so Fast Refresh
// can hot-reload the provider component on its own.
import { useContext } from 'react';
import { PeekContext } from './PeekContext.js';

export function usePeek() {
  const ctx = useContext(PeekContext);
  if (!ctx) throw new Error('usePeek must be used inside PeekProvider');
  return ctx;
}
