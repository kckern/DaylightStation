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
export function useVisibleRefresh({ active = true, intervalMs, reload, poll = reload, refreshOnFocus = false }) {
  useEffect(() => {
    if (!active) return;
    return whileDocumentVisible(resumed => {
      if (resumed) reload();
      // A window can gain focus while the document stayed visible. Give an
      // existing foreground read time to settle, just like an interval tick.
      const onFocus = () => poll();
      if (refreshOnFocus) window.addEventListener('focus', onFocus);
      const timer = intervalMs > 0 ? setInterval(poll, intervalMs) : undefined;
      return () => {
        if (timer !== undefined) clearInterval(timer);
        if (refreshOnFocus) window.removeEventListener('focus', onFocus);
      };
    });
  }, [active, intervalMs, reload, poll, refreshOnFocus]);
}
