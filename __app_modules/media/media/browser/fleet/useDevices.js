import { useCallback, useMemo } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';

function filterPlaybackSurfaces(rawDevices) {
  if (!rawDevices || typeof rawDevices !== 'object') return [];
  return Object.entries(rawDevices)
    .filter(([, cfg]) => cfg && (cfg.content_control || cfg.fleet === true))
    .map(([id, cfg]) => ({ id, ...cfg }));
}

export function useDevices() {
  const { data, loading, error, refresh } = useApiResource('api/v1/device/config', {
    retryTransient: false,
    clearDataOnError: true,
  });
  const devices = useMemo(() => filterPlaybackSurfaces(data?.devices), [data]);
  // Socket recovery and visibility callbacks also call this without awaiting it.
  const refreshDevices = useCallback(async () => {
    try { await refresh(); } catch { /* The resource publishes the read error. */ }
  }, [refresh]);
  return { devices, loading, error, refresh: refreshDevices };
}

export default useDevices;
