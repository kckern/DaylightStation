import { useEffect, useRef, useState } from 'react';

/**
 * The review station's keymap. One capture-phase listener on the document, so a key reaches the
 * station even while the video element (or a button, or a radio) has focus, and the page's
 * preventDefault stops the video reacting to it as well. Text entry is left alone, like useHotkey
 * (frontend/src/lib/hooks/useHotkey.js, whose single-key/no-shift grammar cannot say Shift+Tab or ?).
 *
 * handlers: next, prev, togglePlay, replay, playWithout, verdict(verdict, reason), undo, effect(key),
 * refine(), refineAll(), rework(), help(), escape() -> true when it closed something, bleepLevel(delta),
 * retryPreview().
 *
 * Keymap (owner, 2026-11-21; ops design cf-journey): Space play/pause (always, even on a focused
 * button), Enter play the part with its effect, W without it, ← → step, A approve, X let it play,
 * D redo (then 1-4 / Enter), U undo, R refine this part, Shift+R refine every rough filtered part,
 * M P B K O effect, [ ] bleep level, Shift+D rework flagged, ? keys.
 */
const NON_TEXT_INPUT = new Set(['radio', 'checkbox', 'button', 'range', 'submit', 'reset', 'image', 'file', 'color']);
const REASONS = { 1: 'edges', 2: 'category', 3: 'action', 4: 'timing' };
const EFFECT_KEYS = new Set(['m', 'p', 'b', 'k', 'o']);
const REPEATABLE = new Set(['ArrowLeft', 'ArrowRight']);
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
      // Keep the station shortcuts quiet and leave native dialog navigation alone.
      if (h.helpOpen) {
        if (key === '?' || key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) h.escape?.();
        }
        return;
      }
      // An open menu (the header's ⋯) owns the keyboard: keys must not act behind it.
      if (key !== 'Escape' && document.querySelector?.('[role="menu"]')) return;
      // A modal owns the keyboard; a focused button keeps Space/Enter to press itself.
      if (key !== 'Escape' && (active?.closest?.('[role=dialog]') || e.target?.closest?.('[role=dialog]'))) return;
      const take = (fn) => { e.preventDefault(); e.stopPropagation(); fn?.(); };
      // Space is the film's play/pause wherever focus is: a clicked button must not take it (it
      // outlined the page instead of pausing, owner 2026-11-21). The button loses focus too.
      if (key === ' ' && !redoRef.current) {
        if (e.repeat) return take();
        if (active?.tagName === 'BUTTON' || active?.getAttribute?.('role') === 'button') active.blur?.();
        return take(h.togglePlay);
      }
      // A focused button or link keeps Enter to press itself.
      if (key === 'Enter' && (active?.tagName === 'BUTTON' || active?.tagName === 'A' || active?.getAttribute?.('role') === 'button')) return;
      if (e.repeat && !REPEATABLE.has(key)) { if (redoRef.current || key === ' ' || /^[a-z0-9?[\]]$/.test(lower)) take(); return; }

      if (redoRef.current) {
        if (key === 'Escape') return take(() => openRedo(false));
        if (REASONS[key]) return take(() => { openRedo(false); h.verdict?.('redo', REASONS[key]); });
        if (key === 'Enter') return take(() => { openRedo(false); h.verdict?.('redo', undefined); });
        return take(() => openRedo(false));
      }
      if (key === 'Escape') { if (h.escape?.()) take(); return; }
      if (key === 'Enter' && h.retryPreview) return take(h.retryPreview);
      if (key === 'ArrowRight') return take(h.next);
      if (key === 'ArrowLeft') return take(h.prev);
      if (key === 'Enter') return take(h.replay);
      if (key === '?') return take(h.help);
      if (key === '[') return take(() => h.bleepLevel?.(-BLEEP_LEVEL_STEP));
      if (key === ']') return take(() => h.bleepLevel?.(BLEEP_LEVEL_STEP));
      if (lower === 'a') return take(() => h.verdict?.('approve', undefined));
      if (lower === 'x') return take(() => h.verdict?.('remove', undefined));
      if (lower === 'r' && e.shiftKey) return take(h.refineAll);
      if (lower === 'r') return take(h.refine);
      if (lower === 'd' && e.shiftKey) return take(h.rework);
      if (lower === 'd') return take(() => openRedo(true));
      if (lower === 'u') return take(h.undo);
      if (lower === 'w') return take(h.playWithout);
      if (EFFECT_KEYS.has(lower)) return take(() => h.effect?.(lower));
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [enabled]);

  return { redoOpen, closeRedo: () => openRedo(false) };
}

export default useReviewKeys;
