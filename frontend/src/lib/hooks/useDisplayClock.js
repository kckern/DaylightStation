import { useCallback, useEffect, useState } from 'react';
import { useVisibleRefresh } from './useVisibleRefresh.js';

/** Sample wall time for visible labels. Callers own their start times and deadlines. */
export function useDisplayClock(active = true, intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback(() => setNow(Date.now()), []);
  useEffect(() => {
    if (active && document.visibilityState === 'visible') refresh();
  }, [active, refresh]);
  useVisibleRefresh({ active, intervalMs, reload: refresh });
  return now;
}
