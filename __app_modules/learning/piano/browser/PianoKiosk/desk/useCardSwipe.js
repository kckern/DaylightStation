import { useRef, useState } from 'react';

/** A swipe this far (px), mostly sideways, switches the card. */
export const SWIPE_THRESHOLD = 40;
/** Movement under this (px) is still a tap: a child's tap wanders. */
const SLOP = 12;
/** How far the card follows the finger: half the finger's travel, at most this (px). */
const FOLLOW_CAP = 32;
/** Sideways means the horizontal travel beats the vertical by this factor. */
const MOSTLY = 1.5;
/** The click a browser sends after a drag lands within this window (ms). */
const CLICK_WINDOW = 600;
/** The CSS variable on the deck the card's follow offset is written to. */
export const DRAG_VAR = '--piano-desk-drag';

/**
 * Sideways swipes on one card: the card follows the finger a little while it
 * drags, and a swipe past the threshold calls `onSwipe('left' | 'right')`.
 * Vertical gestures and small wobbles are left alone, so a tap still taps and
 * the page still scrolls. Pointer events cover touch on the kiosk WebView and
 * the mouse in tests.
 *
 * The click a browser may send after a swipe (or a sideways drag of at least
 * half a swipe) is swallowed, so a swipe never also opens the card. The Android
 * WebView sends none after a drag, so the next pointerdown disarms it: a real
 * tap straight after a swipe still opens.
 *
 * Only the first finger counts: a second pointer, or a new one while a gesture
 * is under way, is ignored. A lost pointer capture ends the gesture like a cancel.
 *
 * The follow offset is written straight to `--piano-desk-drag` on the element
 * holding `ref`, so a drag does not re-render the card on every move; only
 * `dragging` (the card animates back once it is false) is React state.
 */
export default function useCardSwipe({ enabled, onSwipe }) {
  const ref = useRef(null);
  const start = useRef(null);
  const swallowUntil = useRef(0);
  const [dragging, setDragging] = useState(false);

  const follow = (px) => { ref.current?.style.setProperty(DRAG_VAR, `${px}px`); };
  const reset = () => { start.current = null; follow(0); setDragging(false); };

  const onPointerDown = (event) => {
    // Any new touch disarms a swallow left over from a drag that got no click.
    if (event.isPrimary !== false) swallowUntil.current = 0;
    if (!enabled || start.current || event.isPrimary === false || event.button > 0) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId, axis: null };
  };

  const onPointerMove = (event) => {
    const at = start.current;
    if (!at || at.id !== event.pointerId) return;
    const dx = event.clientX - at.x;
    const dy = event.clientY - at.y;
    if (!at.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dx) <= Math.abs(dy) * MOSTLY) {
        // Vertical: the page's, not ours. Let go of the gesture entirely.
        start.current = null;
        return;
      }
      at.axis = 'x';
      // Keep the finger's moves even when it leaves the card.
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
      setDragging(true);
    }
    follow(Math.max(-FOLLOW_CAP, Math.min(FOLLOW_CAP, dx / 2)));
  };

  const onPointerUp = (event) => {
    const at = start.current;
    if (!at || at.id !== event.pointerId) return;
    const dx = event.clientX - at.x;
    const dy = event.clientY - at.y;
    const sideways = at.axis === 'x';
    reset();
    if (!sideways) return;
    const swiped = enabled && Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * MOSTLY;
    // A swipe, or a sideways drag of half a swipe or more, is not a tap; a wobble is.
    if (swiped || Math.abs(dx) >= SWIPE_THRESHOLD / 2) swallowUntil.current = Date.now() + CLICK_WINDOW;
    if (swiped) onSwipe(dx < 0 ? 'left' : 'right');
  };

  const onCancel = (event) => { if (start.current && start.current.id === event.pointerId) reset(); };
  // Only the deck's own capture ending counts: taking the capture to the deck makes
  // the card (touch captures implicitly to it) lose one, which must not end the drag.
  const onLost = (event) => { if (event.target === event.currentTarget) onCancel(event); };

  const onPointerLeave = () => {
    // Without a capture (no sideways drag yet), a finger leaving the card ends the gesture.
    if (start.current && start.current.axis !== 'x') start.current = null;
  };

  const onClickCapture = (event) => {
    if (Date.now() < swallowUntil.current) {
      swallowUntil.current = 0;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return {
    ref,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onCancel, onLostPointerCapture: onLost, onPointerLeave, onClickCapture },
    dragging,
  };
}
