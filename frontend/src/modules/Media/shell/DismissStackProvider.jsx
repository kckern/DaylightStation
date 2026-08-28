// frontend/src/modules/Media/shell/DismissStackProvider.jsx
// One Escape handler for the whole app: layers (search dropdown, popovers,
// sheets) register while open; Escape dismisses the topmost layer, and with
// no layers open it falls through to the base action (view back). This
// replaces the old pattern of competing document keydown listeners.
//
// Mantine overlays (Modal/Drawer/Popover/Menu) close themselves on Escape;
// they register with `managed: true` so this handler knows a layer is open
// (and suppresses the base action) without double-dismissing it.
import React, { createContext, useRef, useEffect, useCallback } from 'react';

export const DismissContext = createContext(null);

export function DismissStackProvider({ children, onBaseDismiss }) {
  const layersRef = useRef([]); // [{ id, onDismiss, managed }]
  const baseRef = useRef(onBaseDismiss);
  baseRef.current = onBaseDismiss;

  const register = useCallback((id, onDismiss, managed) => {
    layersRef.current = [...layersRef.current.filter((l) => l.id !== id), { id, onDismiss, managed }];
    return () => {
      layersRef.current = layersRef.current.filter((l) => l.id !== id);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const layers = layersRef.current;
      if (layers.length > 0) {
        const top = layers[layers.length - 1];
        if (!top.managed) {
          e.stopPropagation();
          top.onDismiss?.();
        }
        // managed layers dismiss themselves; either way the base action is suppressed
        return;
      }
      baseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return <DismissContext.Provider value={register}>{children}</DismissContext.Provider>;
}

export default DismissStackProvider;
