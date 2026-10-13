import { useEffect, useState } from 'react';

/**
 * False until `ready` has been true once and the browser has had an idle
 * moment after it; then true for good. Gates requests the first paint does not
 * need (the coach line's dashboard, the sidebar's 30-day range, neighbouring
 * days) behind the ones it does, so a slow one never delays the day on screen
 * and never takes a connection the day's own requests are waiting for. A
 * value already cached still paints meanwhile: a disabled swr reader shows
 * its cached snapshot.
 */
export function useAfterFirstPaint(ready, { timeoutMs = 1000 } = {}) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled || !ready) return undefined;
    const done = () => setSettled(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(done, { timeout: timeoutMs });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(done, 50);
    return () => clearTimeout(id);
  }, [ready, settled, timeoutMs]);
  return settled;
}

export default useAfterFirstPaint;
