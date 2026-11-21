/**
 * useScreenNav — one keyboard + gamepad navigation for a modal screen,
 * the same in every host (fitness Settings, arcade, in-game menu).
 *
 * Keys are read at the window in the capture phase, so they work wherever
 * focus is (even on <body>) and never reach the page behind: arrows and Tab
 * move between enabled buttons (wrapping), Enter presses, Escape/Backspace go
 * back (a held Enter or Escape acts once), and a media remote's next/previous
 * track and play/pause move and press. The gamepad (D-pad/left stick, A or Start, B) comes through
 * useArcadeInput with primeOnStart, so the press that opened the screen does
 * not also act in it. After every render, focus that left the screen or sits
 * on a disabled control goes back to the default ([data-autofocus], else the
 * first enabled button): a button that unmounts (Forget, Close) never strands
 * the keys.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useArcadeInput } from '../ui/useArcadeInput.js';

const KEY_INTENT = {
  ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right',
  Enter: 'select', Escape: 'back', Backspace: 'back',
  // A ring or media remote in keyboard mode often has only these.
  MediaTrackNext: 'down', MediaTrackPrevious: 'up', MediaPlayPause: 'select',
};

export function focusables(root) {
  return root ? [...root.querySelectorAll('button:not([disabled])')] : [];
}

export function defaultFocus(root) {
  return root?.querySelector('[data-autofocus]:not([disabled])') || focusables(root)[0] || null;
}

/**
 * @param {object} p
 * @param {{ current: HTMLElement|null }} p.rootRef
 * @param {boolean} [p.active=true]  false while a child (the key test) owns the keys.
 * @param {Function} p.onBack
 * @param {Function} [p.getGamepads]
 * @param {Function} [p.onRecover]  (why: 'key'|'render') => void, for a debug log.
 * @param {Function} [p.ignoreKey]  (KeyboardEvent) => true to leave a key alone:
 *   on a device page, the keys that remote sends are for trying it, not for moving.
 */
export function useScreenNav({ rootRef, active = true, onBack, getGamepads, onRecover, ignoreKey }) {
  const ignoreKeyRef = useRef(ignoreKey);
  ignoreKeyRef.current = ignoreKey;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onRecoverRef = useRef(onRecover);
  onRecoverRef.current = onRecover;

  const intent = useCallback((name) => {
    const root = rootRef.current;
    if (!root) return;
    if (name === 'back') { onBackRef.current?.(); return; }
    const list = focusables(root);
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement);
    if (i < 0) {
      // Nothing here is focused: the first press only lands focus, so it can
      // never press a button nobody could see highlighted.
      defaultFocus(root)?.focus();
      onRecoverRef.current?.('key');
      return;
    }
    if (name === 'select') { list[i].click(); return; }
    const step = name === 'up' || name === 'left' ? -1 : 1;
    list[(i + step + list.length) % list.length].focus();
  }, [rootRef]);

  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      const name = e.key === 'Tab' ? (e.shiftKey ? 'up' : 'down') : KEY_INTENT[e.key];
      if (!name) return;
      if (ignoreKeyRef.current?.(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // A held Enter or Escape repeats: only the first press acts, so holding
      // it never presses Forget twice or backs out of every level.
      if (e.repeat && (name === 'select' || name === 'back')) return;
      intent(name);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active, intent]);

  useArcadeInput({ onIntent: intent, enabled: active, getGamepads, primeOnStart: true, keyboard: false });

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const a = document.activeElement;
    if (root && (!root.contains(a) || a?.disabled)) {
      const target = defaultFocus(root);
      if (target) {
        target.focus();
        onRecoverRef.current?.('render');
      }
    }
  });
}
