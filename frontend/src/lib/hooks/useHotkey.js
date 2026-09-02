import { useEffect, useRef } from 'react';

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/**
 * Bind a global hotkey. `combo`: 'mod+k' (⌘ on mac / Ctrl elsewhere),
 * 'escape', '/', or a plain letter. Escape always fires; other combos are
 * suppressed while the user is typing unless allowInInput.
 */
export function useHotkey(combo, handler, { allowInInput = false } = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const [mod, key] = combo.includes('+') ? combo.split('+') : [null, combo];
    const wantMod = mod === 'mod';
    const wantKey = key.toLowerCase();

    const onKey = (e) => {
      if (e.key.toLowerCase() !== wantKey) return;
      if (wantMod && !(e.metaKey || e.ctrlKey)) return;
      if (!wantMod && (e.metaKey || e.ctrlKey || e.altKey)) return;
      const escape = wantKey === 'escape';
      if (!escape && !allowInInput && isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      handlerRef.current(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [combo, allowInInput]);
}

export default useHotkey;
