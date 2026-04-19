import { useFleetContext } from './FleetProvider.jsx';

export function useDevice(deviceId) {
  const { devices, byDevice } = useFleetContext();
  const config = devices.find((d) => d.id === deviceId);
  if (!config) return null;
  const entry = byDevice.get(deviceId);
  return {
    config,
    snapshot: entry?.snapshot ?? null,
    reason: entry?.reason ?? null,
    lastSeenAt: entry?.lastSeenAt ?? null,
    isStale: entry?.isStale ?? false,
    offline: entry?.offline ?? false,
  };
}

export default useDevice;
