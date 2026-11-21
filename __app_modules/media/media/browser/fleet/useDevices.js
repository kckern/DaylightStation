import { useCallback, useMemo } from 'react';
import { useDeviceConfig } from '@/lib/hooks/useDeviceConfig.js';

function filterPlaybackSurfaces(rawDevices) {
  if (!rawDevices || typeof rawDevices !== 'object') return [];
  return Object.entries(rawDevices)
    .filter(([, cfg]) => cfg && (cfg.content_control || cfg.fleet === true))
    .map(([id, cfg]) => ({ id, ...cfg }));
}

export function useDevices() {
  const { devices: roster, loading, error, refresh } = useDeviceConfig({
    retryTransient: false,
    clearDataOnError: true,
  });
  const devices = useMemo(() => filterPlaybackSurfaces(roster), [roster]);
  // Socket recovery and visibility callbacks also call this without awaiting it.
  const refreshDevices = useCallback(async () => {
    try { await refresh(); } catch { /* The resource publishes the read error. */ }
  }, [refresh]);
  return { devices, loading, error, refresh: refreshDevices };
}

export default useDevices;
