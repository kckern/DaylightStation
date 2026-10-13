import { useEffect, useRef } from 'react';

/**
 * Skip a refused video while a SCREEN's Player is waiting for it to be repaired.
 *
 * Screens HOLD on a refusal (owner ruling 2026-10-07) — they never skip on
 * their own — so the household needs a way out that works with a TV remote:
 * OK or the media-next key. Back is unreliable on the Shield, so nothing here
 * depends on it.
 *
 * This is a page-level listener, so it is deliberately polite:
 *  - only Enter / NumpadEnter / MediaTrackNext (never D-pad or Tab: those
 *    belong to screen navigation, overlay buttons and the fitness display);
 *  - only when focus is on the page body or inside this Player's root — a
 *    focused button elsewhere owns its own Enter;
 *  - only while `canConsume()` says the Skip pill is actually on screen;
 *  - the key is swallowed (stopImmediatePropagation) only when a skip really
 *    happened, so any other listener still hears every key it was owed;
 *  - repeats within DEBOUNCE_MS of a real skip (a held key, a double tap) are
 *    absorbed once; after the window the next press skips again.
 */
const SKIP_KEYS = new Set(['Enter', 'NumpadEnter', 'MediaTrackNext']);
export const SKIP_DEBOUNCE_MS = 1000;

function focusIsOurs(target, root) {
  if (!(target instanceof Element)) return true; // window / document
  if (target === document.body || target === document.documentElement) return true;
  return Boolean(root && root.contains(target));
}

/**
 * True when the element at the Player's centre is the Player (or inside it).
 * A sleeping screen's shader sits above the Player and takes pointer events, so
 * the Player must not treat OK as its own while asleep: OK is the wake key.
 */
export function playerIsHitTarget(shell) {
  const r = shell?.getBoundingClientRect?.();
  if (!r || typeof document.elementFromPoint !== 'function') return true;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !hit || shell.contains(hit);
}

/**
 * @param {object} p
 * @param {boolean} p.active   a wait is on screen for a screen-owned Player
 * @param {() => boolean|void} p.onSkip  returns false when nothing was skipped
 * @param {() => boolean} [p.canConsume]  the Skip pill is visible right now
 * @param {{current: Element|null}} [p.rootRef]  this Player's root element
 */
export function useSourceWaitSkipKeys({ active, onSkip, canConsume, rootRef }) {
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;
  const canRef = useRef(canConsume);
  canRef.current = canConsume;
  const rootRefRef = useRef(rootRef);
  rootRefRef.current = rootRef;

  const activeRef = useRef(active);
  activeRef.current = active;
  // Debounce state lives in a ref and the listener is attached for the hook's
  // whole life: a held key's repeat must not act on the NEXT item, even if the
  // wait briefly deactivates between items.
  const lastSkipAtRef = useRef(-Infinity);

  useEffect(() => {
    const onKey = (event) => {
      if (!SKIP_KEYS.has(event.key)) return;
      if (event.defaultPrevented) return; // someone nearer already took it
      const t = event.target;
      if (t instanceof Element && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      )) return;
      if (!focusIsOurs(t, rootRefRef.current?.current ?? null)) return;
      const now = Date.now();
      if (now - lastSkipAtRef.current < SKIP_DEBOUNCE_MS) {
        // A real skip just happened: the repeat of that same press must not
        // also pause the next item. Bounded to the debounce window.
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!activeRef.current) return;
      if (typeof canRef.current === 'function' && !canRef.current()) return;
      const skipped = onSkipRef.current?.({ key: event.key });
      if (skipped === false) return; // a no-op skip consumes nothing
      lastSkipAtRef.current = now;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export default useSourceWaitSkipKeys;
