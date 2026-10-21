import { useEffect, useRef } from 'react';
import { noteKeyEvent } from "../shared/inputVia.js";
import { keyFromCode } from "../shared/physicalKey.js";

const TYPING = new Set(['INPUT', 'TEXTAREA']);
/**
 * One key map per debrief screen. Never Esc (FKB captures it on the Portal).
 * Keys typed into a field are never commands, except `tab` (read aloud) and
 * `enter`, which the field's own onKeyDown handles before this sees it.
 */
export function useSchoolDebriefKeys(map, { enabled = true } = {}) {
  const ref = useRef(map); ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const byKey = event.key === ' ' ? ' ' : String(event.key).toLowerCase();
      const byCode = keyFromCode(event.code);
      if (TYPING.has(event.target?.tagName) && (byCode ?? byKey) !== 'tab') return;
      const action = (byCode !== null ? ref.current[byCode] : undefined) ?? ref.current[byKey];
      if (action) { event.preventDefault(); noteKeyEvent(event); action(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
export default useSchoolDebriefKeys;

/** Read text aloud with the browser voice, if the device has one. */
export function speak(text) {
  try { const s = window.speechSynthesis; if (!s || !text) return; s.cancel(); s.speak(new SpeechSynthesisUtterance(text)); } catch { /* no voice */ }
}
