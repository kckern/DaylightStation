import { useEffect, useRef, useState } from 'react';

/**
 * The review station's keymap. One capture-phase listener on the document, so a key reaches the
 * station even while the video element (or a button, or a radio) has focus, and the page's
 * preventDefault stops the video reacting to it as well. Text entry is left alone, like useHotkey
 * (frontend/src/lib/hooks/useHotkey.js, whose single-key/no-shift grammar cannot say Shift+Tab or ?).
 *
 * handlers: next, prev, replay, verdict(verdict, reason), undo, cycleKind, effect(key), widen,
 * rework(), help(), escape() -> true when it closed something, bleepLevel(delta) (Task 6; optional).
 */
const NON_TEXT_INPUT = new Set(['radio', 'checkbox', 'button', 'range', 'submit', 'reset', 'image', 'file', 'color']);
const REASONS = { 1: 'edges', 2: 'category', 3: 'action', 4: 'timing' };
const EFFECT_KEYS = new Set(['m', 'p', 'b', 'k']);
const REPEATABLE = new Set(['ArrowLeft', 'ArrowRight', 'Tab']);
/** Hook point for the per-film bleep level (Task 6): `[` lowers, `]` raises by this much. */
export const BLEEP_LEVEL_STEP = 0.05;

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  if (NON_TEXT_INPUT.has(String(el.type).toLowerCase())) return false;
  // A closed read-only combobox (a Mantine Select) takes no typing; open, it uses the arrow keys.
  if (el.readOnly && el.getAttribute('aria-expanded') !== 'true') return false;
  return true;
}

export function useReviewKeys(handlers, { enabled = true } = {}) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const redoRef = useRef(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const openRedo = (on) => { redoRef.current = on; setRedoOpen(on); };

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const h = ref.current;
      const { key } = e;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const active = document.activeElement;
      if (key !== 'Escape' && isTypingTarget(active)) return;
      // A modal owns the keyboard; a focused button keeps Space/Enter to press itself.
      if (key !== 'Escape' && (active?.closest?.('[role=dialog]') || e.target?.closest?.('[role=dialog]'))) return;
      if ((key === ' ' || key === 'Enter') && (active?.tagName === 'BUTTON' || active?.tagName === 'A' || active?.getAttribute?.('role') === 'button')) return;
      const take = (fn) => { e.preventDefault(); e.stopPropagation(); fn?.(); };
      if (e.repeat && !REPEATABLE.has(key)) { if (redoRef.current || key === ' ' || /^[a-z0-9?[\]]$/.test(lower)) take(); return; }

      if (redoRef.current) {
        if (key === 'Escape') return take(() => openRedo(false));
        if (REASONS[key]) return take(() => { openRedo(false); h.verdict?.('redo', REASONS[key]); });
        if (key === 'Enter') return take(() => { openRedo(false); h.verdict?.('redo', undefined); });
        return take(() => openRedo(false));
      }
      if (key === 'Escape') { if (h.escape?.()) take(); return; }
      // The help sheet is read-only: only Esc and ? (which closes it) act while it is open.
      if (h.helpOpen && key !== '?') return take();
      if (key === 'ArrowRight' || (key === 'Tab' && !e.shiftKey)) return take(h.next);
      if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) return take(h.prev);
      if (key === ' ') return take(h.replay);
      if (key === '?') return take(h.help);
      if (key === '[') return take(() => h.bleepLevel?.(-BLEEP_LEVEL_STEP));
      if (key === ']') return take(() => h.bleepLevel?.(BLEEP_LEVEL_STEP));
      if (lower === 'a') return take(() => h.verdict?.('approve', undefined));
      if (lower === 'r') return take(() => h.verdict?.('remove', undefined));
      if (lower === 'i') return take(() => h.verdict?.('ignore', undefined));
      if (lower === 'd' && e.shiftKey) return take(h.rework);
      if (lower === 'd') return take(() => openRedo(true));
      if (lower === 'u') return take(h.undo);
      if (lower === 'f') return take(h.cycleKind);
      if (lower === 'w') return take(h.widen);
      if (EFFECT_KEYS.has(lower)) return take(() => h.effect?.(lower));
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [enabled]);

  return { redoOpen, closeRedo: () => openRedo(false) };
}

export default useReviewKeys;
