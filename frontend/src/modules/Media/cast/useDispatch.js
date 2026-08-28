// useDispatch.js — the hook half of DispatchProvider.jsx, split out so Fast
// Refresh can hot-reload the provider component on its own.
import { useContext } from 'react';
import { DispatchContext } from './DispatchProvider.jsx';

export function useDispatch() {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error('useDispatch must be used inside DispatchProvider');
  return ctx;
}
