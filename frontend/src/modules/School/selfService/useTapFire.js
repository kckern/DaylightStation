/**
 * useTapFire — the panel's touch-down button handlers, shared by the
 * self-service Keypad and the reading shelf's NumberPad and overlays.
 *
 * Extracted verbatim from Keypad.jsx; the doc below is the original.
 */
import { useCallback, useRef } from 'react';

/**
 * Buttons that fire on TOUCH-DOWN.
 *
 * The pad is a wall panel a child jabs at, and `onClick` waits for a full
 * press-and-release ON the same element — a jab that slides a few pixels, or a
 * finger that rolls off the key, produces nothing at all, which is exactly the
 * "the buttons are hard to press" complaint. `pointerdown` fires the moment the
 * finger lands, for touch and mouse alike.
 *
 * `preventDefault()` on pointerdown suppresses the compatibility mouse events
 * (focus, text selection, the drag ghost) but NOT the click that follows, so
 * the click handler stays for keyboard/synthetic activation and guards against
 * firing the same tap twice. The guard is a timestamp rather than a flag
 * because a pointerdown that never becomes a click (finger dragged off the key)
 * must not swallow the NEXT activation.
 */
export default function useTapFire() {
  const lastPointerAt = useRef(0);
  return useCallback((fn) => ({
    onPointerDown: (event) => {
      event.preventDefault();
      lastPointerAt.current = Date.now();
      fn();
    },
    onClick: () => {
      if (Date.now() - lastPointerAt.current < 700) return; // our own tap, arriving again
      fn();
    },
  }), []);
}
