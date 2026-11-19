import { useCallback, useSyncExternalStore } from 'react';

const noop = () => {};

/** Observe the durable session snapshot of an already-resolved controller. */
export function useControllerSnapshot(controller) {
  const subscribe = useCallback(
    notify => controller?.subscribe?.(notify) ?? noop,
    [controller],
  );
  const getSnapshot = useCallback(() => controller?.getSnapshot?.() ?? null, [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
