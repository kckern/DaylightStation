import { useEffect, useRef } from 'react';

const TYPING = new Set(['INPUT', 'TEXTAREA']);

/**
 * The map's name for a physical key, from `event.code`. The Bluetooth keyboard
 * may be on a Korean layout, where `event.key` for H is `ㅗ` — the physical
 * key is what the on-screen hint means, so it wins; `key` is the fallback.
 */
function keyFromCode(code) {
  if (typeof code !== 'string') return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === 'Space') return ' ';
  if (code === 'Enter' || code === 'NumpadEnter') return 'enter';
  return null;
}

/** One keyboard map per screen (spec §6 input map). Never Esc — FKB captures it on the Portal. */
export function useWordLadderKeys(map, { enabled = true } = {}) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event) => {
      if (TYPING.has(event.target?.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
      const byKey = event.key === ' ' ? ' ' : String(event.key).toLowerCase();
      const byCode = keyFromCode(event.code);
      const action = (byCode !== null ? ref.current[byCode] : undefined) ?? ref.current[byKey];
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export default useWordLadderKeys;
