// frontend/src/modules/Media/fleet/useFleetSummary.js
// Fleet-at-a-glance numbers for the dock indicator.
import { useCallback, useSyncExternalStore } from 'react';
import { useFleetContext } from './useFleetContext.js';

const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

export function useFleetSummary() {
  const { store, devices } = useFleetContext();
  const subscribe = useCallback((cb) => store.subscribeAll(cb), [store]);
  const get = useCallback(() => store.getAll(), [store]);
  const byDevice = useSyncExternalStore(subscribe, get, get);

  let active = 0;
  let playing = 0;
  let paused = 0;
  for (const [, entry] of byDevice) {
    if (entry.offline) continue;
    const state = entry.snapshot?.state;
    if (ACTIVE_STATES.has(state)) active += 1;
    if (state === 'playing') playing += 1;
    if (state === 'paused') paused += 1;
  }
  return { active, playing, paused, total: devices.length, byDevice };
}

export default useFleetSummary;
