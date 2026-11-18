import { useEffect } from 'react';

/** Poll an active view and refresh immediately when the document returns to the foreground. */
export function useVisibleRefresh({ active = true, intervalMs, reload }) {
  useEffect(() => {
    if (!active) return;
    let timer;
    function synchronize(event) {
      clearInterval(timer);
      if (document.visibilityState !== 'visible') return;
      if (event) reload();
      if (intervalMs > 0) timer = setInterval(reload, intervalMs);
    }
    synchronize();
    document.addEventListener('visibilitychange', synchronize);
    return () => {
      document.removeEventListener('visibilitychange', synchronize);
      clearInterval(timer);
    };
  }, [active, intervalMs, reload]);
}
