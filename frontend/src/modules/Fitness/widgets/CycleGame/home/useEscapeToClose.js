import { useEffect } from 'react';

/** Dismiss a modal on the Escape key. Cleans up its own listener. */
export function useEscapeToClose(onClose) {
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}
