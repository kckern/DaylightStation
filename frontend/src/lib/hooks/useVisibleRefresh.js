import { useEffect } from 'react';

/** Start work while visible. Release the work's resources on hide or disposal. */
export function whileDocumentVisible(start) {
  let release;
  function synchronize(event) {
    release?.();
    release = undefined;
    if (document.visibilityState === 'visible') release = start(Boolean(event));
  }
  synchronize();
  document.addEventListener('visibilitychange', synchronize);
  return () => {
    document.removeEventListener('visibilitychange', synchronize);
    release?.();
  };
}

/** Poll an active view and refresh immediately when the document returns to the foreground. */
export function useVisibleRefresh({ active = true, intervalMs, reload }) {
  useEffect(() => {
    if (!active) return;
    return whileDocumentVisible(resumed => {
      if (resumed) reload();
      if (intervalMs > 0) {
        const timer = setInterval(reload, intervalMs);
        return () => clearInterval(timer);
      }
    });
  }, [active, intervalMs, reload]);
}
