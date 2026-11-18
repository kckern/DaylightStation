import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";

function filterPlaybackSurfaces(rawDevices) {
  if (!rawDevices || typeof rawDevices !== 'object') return [];
  return Object.entries(rawDevices)
    .filter(([, cfg]) => cfg && (cfg.content_control || cfg.fleet === true))
    .map(([id, cfg]) => ({ id, ...cfg }));
}

export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const latestRead = useRef(0);
  const load = useCallback(async () => {
    const read = ++latestRead.current;
    setLoading(true);
    setError(null);
    try {
      const res = await DaylightAPI('api/v1/device/config');
      if (read !== latestRead.current) return;
      setDevices(filterPlaybackSurfaces(res?.devices));
      setLoading(false);
    } catch (err) {
      if (read !== latestRead.current) return;
      setError(err);
      setDevices([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { latestRead.current++; };
  }, [load]);

  return { devices, loading, error, refresh: load };
}

export default useDevices;
