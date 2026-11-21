import { useEffect } from 'react';

/** Let the mounted route own the existing viewport tag for its lifetime. */
export function useViewportContent(update) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute('content');
    meta.setAttribute('content', update(original ?? ''));
    return () => {
      if (original === null) meta.removeAttribute('content');
      else meta.setAttribute('content', original);
    };
  }, [update]);
}
