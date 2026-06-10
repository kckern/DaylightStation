// frontend/src/modules/Media/fleet/useFleetSummary.js
// Fleet-at-a-glance numbers for the dock indicator.
import { useCallback, useSyncExternalStore } from 'react';
import { useFleetContext } from './FleetProvider.jsx';

const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

export function useFleetSummary() {
  const { store, devices } = useFleetContext();
  const subscribe = useCallback((cb) => store.subscribeAll(cb), [store]);
  const get = useCallback(() => store.getAll(), [store]);
  const byDevice = useSyncExternalStore(subscribe, get, get);

  let active = 0;
  for (const [, entry] of byDevice) {
    if (!entry.offline && ACTIVE_STATES.has(entry.snapshot?.state)) active += 1;
  }
  return { active, total: devices.length, byDevice };
}

export default useFleetSummary;
