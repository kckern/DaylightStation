/**
 * useArcadeInput — keyboard + gamepad directional input for the arcade shell.
 *
 * Emits semantic intents ('up'|'down'|'left'|'right'|'select'|'back') so the
 * shell can stay presentation-only. Gamepad support is mandatory on the garage
 * kiosk, so we poll `navigator.getGamepads()` each frame with edge-detection
 * (fire once per press, not every frame) alongside keyboard handlers.
 */

import { useEffect, useRef } from 'react';

const AXIS_DEADZONE = 0.5;
// Standard-mapping button indices.
const BTN = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const KEY_INTENT = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'select', ' ': 'select', Spacebar: 'select',
  Escape: 'back', Backspace: 'back',
};

/**
 * @param {object} opts
 * @param {(intent: string) => void} opts.onIntent
 * @param {boolean} [opts.enabled=true]
 * @param {() => (Array|null)} [opts.getGamepads]  injectable for tests
 */
export function useArcadeInput({ onIntent, enabled = true, getGamepads } = {}) {
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;

  // Keyboard.
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (e) => {
      const intent = KEY_INTENT[e.key];
      if (!intent) return;
      e.preventDefault();
      onIntentRef.current?.(intent);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);

  // Gamepad — rAF poll with per-button edge detection.
  useEffect(() => {
    if (!enabled) return undefined;
    const read = getGamepads
      || (typeof navigator !== 'undefined' && navigator.getGamepads
        ? () => navigator.getGamepads()
        : () => []);

    let raf = null;
    const prev = new Map(); // key → boolean (was-active last frame)

    const edge = (key, active) => {
      const was = prev.get(key) || false;
      prev.set(key, active);
      return active && !was; // rising edge only
    };

    const poll = () => {
      const pads = read() || [];
      for (const gp of pads) {
        if (!gp) continue;
        const b = gp.buttons || [];
        const ax = gp.axes || [];
        const pressed = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
        const intents = {
          up: pressed(BTN.UP) || ax[1] < -AXIS_DEADZONE,
          down: pressed(BTN.DOWN) || ax[1] > AXIS_DEADZONE,
          left: pressed(BTN.LEFT) || ax[0] < -AXIS_DEADZONE,
          right: pressed(BTN.RIGHT) || ax[0] > AXIS_DEADZONE,
          select: pressed(BTN.A) || pressed(BTN.START),
          back: pressed(BTN.B),
        };
        for (const [intent, active] of Object.entries(intents)) {
          if (edge(`${gp.index}:${intent}`, active)) onIntentRef.current?.(intent);
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [enabled, getGamepads]);
}

export default useArcadeInput;
