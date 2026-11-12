import { useEffect, useRef } from 'react';
import { useGamepadKeys } from '../../lib/useGamepadKeys.js';
import { menuAction } from '../../lib/skylineInvaders/menuKeys.js';

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Keyboard, foot pad and gamepad for one menu screen. `onAction(action, source)`
 * hears 'left' | 'right' | 'up' | 'down' | 'accept' | 'back'. Only one screen
 * should be active at a time.
 *
 * Keys are taken in the capture phase and stopped there, so a key that drives
 * the game never also reaches the fitness app's own shortcuts.
 */
export default function useMenuInput(active, onAction) {
  const latest = useRef(onAction);
  latest.current = onAction;

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      const target = event.target;
      if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return;
      // A held key is one press. It is still ours: swallow the repeats.
      const action = menuAction({ key: event.key, code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey });
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) latest.current?.(action, 'key');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);

  useGamepadKeys(active, (key) => {
    const action = menuAction({ key });
    if (action) latest.current?.(action, 'gamepad');
  });
}
