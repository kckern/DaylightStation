import { useEffect, useRef } from 'react';
import { noteKeyEvent } from './inputVia.js';
import { keyFromCode } from './physicalKey.js';

export function useProgramKeys(map, { enabled = true } = {}) {
  const ref = useRef(map); ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const key = event.key === ' ' ? ' ' : String(event.key).toLowerCase();
      const code = keyFromCode(event.code);
      if ((event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) && (code ?? key) !== 'tab') return;
      const action = (code !== null ? ref.current[code] : undefined) ?? ref.current[key];
      if (action) { event.preventDefault(); noteKeyEvent(event); action(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
export function speak(text) {
  try { const speech = window.speechSynthesis; if (!speech || !text) return; speech.cancel(); speech.speak(new SpeechSynthesisUtterance(text)); } catch { /* optional browser facility */ }
}
