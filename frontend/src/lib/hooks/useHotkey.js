import { useEffect, useRef } from 'react';

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/**
 * Bind a document shortcut such as 'mod+k', 'escape', '/', or a plain letter.
 * Launch shortcuts yield to focused modals and editable controls. Set
 * allowInInput to opt into editable controls. Escape can dismiss either.
 * Return false from the handler when no action is available.
 */
export function useHotkey(combo, handler, { allowInInput = false } = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const [mod, key] = combo.includes('+') ? combo.split('+') : [null, combo];
    const wantMod = mod === 'mod';
    const wantKey = key.toLowerCase();

    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || e.repeat || e.altKey) return;
      if (e.key.toLowerCase() !== wantKey) return;
      if (wantMod && !(e.metaKey || e.ctrlKey)) return;
      if (!wantMod && (e.metaKey || e.ctrlKey)) return;
      if (wantKey !== 'escape') {
        const targets = [e.target, document.activeElement];
        const owned = targets.some(target => target?.closest?.('[aria-modal="true"]') ||
          (!allowInInput && isTypingTarget(target)));
        if (owned) return;
      }
      if (handlerRef.current(e) !== false) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [combo, allowInInput]);
}

export default useHotkey;
