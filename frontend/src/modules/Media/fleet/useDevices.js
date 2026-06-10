import { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

function filterPlaybackSurfaces(rawDevices) {
  if (!rawDevices || typeof rawDevices !== 'object') return [];
  return Object.entries(rawDevices)
    .filter(([, cfg]) => cfg && cfg.content_control)
    .map(([id, cfg]) => ({ id, ...cfg }));
}

export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await DaylightAPI('api/v1/device/config');
      setDevices(filterPlaybackSurfaces(res?.devices));
      setLoading(false);
    } catch (err) {
      setError(err);
      setDevices([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { devices, loading, error, refresh: load };
}

export default useDevices;
