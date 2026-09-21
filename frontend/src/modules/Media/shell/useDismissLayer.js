// useDismissLayer.js — the hook half of DismissStackProvider.jsx, split out
// so Fast Refresh can hot-reload the provider component on its own.
import { useContext, useEffect, useId } from 'react';
import { DismissContext } from './DismissStackProvider.jsx';

/**
 * Register a dismissable layer while `open` is true.
 * `managed: true` for Mantine overlays that close themselves on Escape.
 * `isActive` lets a persistent host participate only while its portaled layer
 * is actually open; inactive layers are skipped instead of swallowing Back.
 */
export function useDismissLayer(open, onDismiss, { managed = false, isActive } = {}) {
  const register = useContext(DismissContext);
  const id = useId();
  useEffect(() => {
    if (!open || !register) return undefined;
    return register(id, onDismiss, managed, isActive);
  }, [open, onDismiss, managed, isActive, register, id]);
}
