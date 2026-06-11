// frontend/src/modules/Media/fleet/useDevice.js
// Per-device live entry — re-renders only when THIS device's state changes.
import { useCallback, useSyncExternalStore } from 'react';
import { useFleetContext } from './FleetProvider.jsx';

export function useDevice(deviceId) {
  const { store, devices } = useFleetContext();
  const subscribe = useCallback(
    (cb) => store.subscribeDevice(deviceId, cb),
    [store, deviceId]
  );
  const get = useCallback(() => store.getEntry(deviceId), [store, deviceId]);
  const entry = useSyncExternalStore(subscribe, get, get);
  const device = devices.find((d) => d.id === deviceId) ?? null;
  return { device, entry };
}

export default useDevice;
