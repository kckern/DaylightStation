import { useLayoutEffect, useRef, useState } from 'react';

/** Admit one command per key and keep different keys independently actionable. */
export function useKeyedSubmission() {
  const mounted = useRef(false);
  const active = useRef(new Set());
  const [pending, setPending] = useState(() => new Set());

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async (key, command) => {
    if (!mounted.current || active.current.has(key)) return;
    active.current.add(key);
    setPending(new Set(active.current));
    try {
      return await command();
    } finally {
      active.current.delete(key);
      if (mounted.current) setPending(new Set(active.current));
    }
  };

  return { pending, run };
}
