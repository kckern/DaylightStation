import { createContext, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export const DismissContext = createContext(null);

export function DismissStackProvider({ children, onBaseDismiss }) {
  const layersRef = useRef([]);
  const baseRef = useRef(onBaseDismiss);
  useLayoutEffect(() => {
    baseRef.current = onBaseDismiss;
  }, [onBaseDismiss]);

  const register = useCallback(callbacks => {
    const layer = { callbacks };
    layersRef.current.push(layer);
    return () => {
      layersRef.current = layersRef.current.filter(item => item !== layer);
    };
  }, []);

  useEffect(() => {
    const pendingTasks = new Set();
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Mantine's input popup may close itself during target handling without
      // preventing the event. Honor the same ownership marker as Mantine Modal.
      if (event.target?.getAttribute?.('data-mantine-stop-propagation') === 'true') return;
      const layers = layersRef.current;
      let top = null;
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (layers[index].callbacks.current.isActive?.(event) !== false) {
          top = layers[index];
          break;
        }
      }
      if (!top && !baseRef.current) return;
      const managed = top?.callbacks.current.managed;
      // Snapshot the owner at capture and give target/portal handlers the
      // full native event before dismissing or falling back to route Back.
      const task = setTimeout(() => {
        pendingTasks.delete(task);
        if (event.defaultPrevented) return;
        if (top) {
          const current = top.callbacks.current;
          if (!managed && layersRef.current.includes(top) && current.isActive?.(event) !== false) {
            current.onDismiss?.(event);
          }
          return;
        }
        baseRef.current?.();
      }, 0);
      pendingTasks.add(task);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      pendingTasks.forEach(task => clearTimeout(task));
    };
  }, []);

  return <DismissContext.Provider value={register}>{children}</DismissContext.Provider>;
}

export default DismissStackProvider;
