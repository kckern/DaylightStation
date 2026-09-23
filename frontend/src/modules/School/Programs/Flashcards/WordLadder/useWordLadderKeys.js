import { useEffect, useRef } from 'react';

const TYPING = new Set(['INPUT', 'TEXTAREA']);

/** One keyboard map per screen (spec §6 input map). Never Esc — FKB captures it on the Portal. */
export function useWordLadderKeys(map, { enabled = true } = {}) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event) => {
      if (TYPING.has(event.target?.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key === ' ' ? ' ' : String(event.key).toLowerCase();
      const action = ref.current[key];
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export default useWordLadderKeys;
