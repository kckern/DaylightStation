import { useEffect } from 'react';

/** While `active`, prompt before an accidental unload (pull-to-refresh backstop). */
export function useReloadGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [active]);
}

export default useReloadGuard;
