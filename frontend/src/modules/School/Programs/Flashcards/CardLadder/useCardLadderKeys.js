import { useEffect, useRef } from 'react';
import { noteKeyEvent } from './inputVia.js';

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
  if (code === 'Tab') return 'tab';
  if (code === 'Backslash') return '\\';
  if (code === 'ArrowLeft') return 'arrowleft';
  return null;
}

/**
 * One keyboard map per screen (spec §6 input map). Never Esc — FKB captures it on the Portal.
 *
 * Map names: letters/digits as themselves, `' '` Space, `enter`, `tab` (hear
 * it again), `'\\'` Backslash (the hunted-for skip), `arrowleft`.
 *
 * Keys typed into a field are never commands — EXCEPT `tab`: it inserts
 * nothing, so on a typing item it can still mean "hear it again" without the
 * field losing focus (the default, which would move focus, is prevented).
 */
export function useCardLadderKeys(map, { enabled = true } = {}) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const byKey = event.key === ' ' ? ' ' : String(event.key).toLowerCase();
      const byCode = keyFromCode(event.code);
      if (TYPING.has(event.target?.tagName) && (byCode ?? byKey) !== 'tab') return;
      const action = (byCode !== null ? ref.current[byCode] : undefined) ?? ref.current[byKey];
      // Noted first, so whatever the action logs knows it was this key (spec §8 input).
      if (action) { event.preventDefault(); noteKeyEvent(event); action(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export default useCardLadderKeys;
