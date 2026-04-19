import { useMemo } from 'react';
import { useFleetContext } from './FleetProvider.jsx';

export function useFleetSummary() {
  const { devices, byDevice } = useFleetContext();
  return useMemo(() => {
    const total = devices.length;
    let online = 0;
    let offline = 0;
    for (const d of devices) {
      const entry = byDevice.get(d.id);
      if (!entry) continue;
      if (entry.offline) { offline += 1; continue; }
      if (entry.snapshot) online += 1;
    }
    return { total, online, offline };
  }, [devices, byDevice]);
}

export default useFleetSummary;
