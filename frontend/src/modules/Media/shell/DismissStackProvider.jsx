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
  const layersRef = useRef([]); // [{ id, onDismiss, managed, isActive }]
  const baseRef = useRef(onBaseDismiss);
  baseRef.current = onBaseDismiss;

  const register = useCallback((id, onDismiss, managed, isActive) => {
    layersRef.current = [
      ...layersRef.current.filter((l) => l.id !== id),
      { id, onDismiss, managed, isActive },
    ];
    return () => {
      layersRef.current = layersRef.current.filter((l) => l.id !== id);
    };
  }, []);

  useEffect(() => {
    // A target/portal handler can close its layer before document bubble.
    // Keep ownership for this native event so that Escape cannot also Back.
    // Capture only observes. A task, rather than a microtask, runs after the
    // browser has completed trusted native key dispatch, so target handlers
    // can prevent default or finish their own managed-menu handling first.
    let disposed = false;
    const pendingTasks = new Set();
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const layers = layersRef.current;
      let top = null;
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (layers[index].isActive?.(e) !== false) {
          top = layers[index];
          break;
        }
      }
      const task = setTimeout(() => {
        pendingTasks.delete(task);
        if (disposed || e.defaultPrevented) return;
        if (top) {
          // A child may already have dismissed/unregistered this owner.
          if (!top.managed && layersRef.current.includes(top) && top.isActive?.(e) !== false) top.onDismiss?.(e);
          // The original owner consumes this event even if it has closed.
          return;
        }
        baseRef.current?.();
      }, 0);
      pendingTasks.add(task);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      disposed = true;
      pendingTasks.forEach(task => clearTimeout(task));
      pendingTasks.clear();
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return <DismissContext.Provider value={register}>{children}</DismissContext.Provider>;
}

export default DismissStackProvider;
