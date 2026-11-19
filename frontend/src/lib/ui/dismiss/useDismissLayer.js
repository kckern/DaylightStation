import { useContext, useLayoutEffect, useRef } from 'react';
import { DismissContext } from './DismissStackProvider.jsx';

/**
 * Register a layer for one open visit. Pass `managed: true` when it handles
 * Escape itself. Use `isActive` when a persistent portal opens independently.
 * Returns whether the shared stack handles this open visit.
 */
export function useDismissLayer(open, onDismiss, { managed = false, isActive } = {}) {
  const register = useContext(DismissContext);
  const callbacks = useRef({ onDismiss, managed, isActive });
  useLayoutEffect(() => {
    callbacks.current = { onDismiss, managed, isActive };
  }, [onDismiss, managed, isActive]);
  useLayoutEffect(() => {
    if (!open || !register) return undefined;
    return register(callbacks);
  }, [open, register]);
  return Boolean(open && register);
}
