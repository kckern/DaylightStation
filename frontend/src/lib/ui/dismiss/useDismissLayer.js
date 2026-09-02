// useDismissLayer.js — the hook half of DismissStackProvider.jsx, split out
// so Fast Refresh can hot-reload the provider component on its own.
// Ported from frontend/src/modules/Media/shell/useDismissLayer.js.
import { useContext, useEffect, useId } from 'react';
import { DismissContext } from './DismissStackProvider.jsx';

/**
 * Register a dismissable layer while `open` is true.
 * `managed: true` for Mantine overlays that close themselves on Escape.
 */
export function useDismissLayer(open, onDismiss, { managed = false } = {}) {
  const register = useContext(DismissContext);
  const id = useId();
  useEffect(() => {
    if (!open || !register) return undefined;
    return register(id, onDismiss, managed);
  }, [open, onDismiss, managed, register, id]);
}
