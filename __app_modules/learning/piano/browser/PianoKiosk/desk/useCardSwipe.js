import { useRef, useState } from 'react';

/** A swipe this far (px), mostly sideways, switches the card. */
export const SWIPE_THRESHOLD = 40;
/** Movement under this (px) is still a tap. */
const SLOP = 8;
/** How far the card follows the finger: half the finger's travel, at most this (px). */
const FOLLOW_CAP = 32;
/** Sideways means the horizontal travel beats the vertical by this factor. */
const MOSTLY = 1.5;
/** The click a browser sends after a drag lands within this window (ms). */
const CLICK_WINDOW = 600;

/**
 * Sideways swipes on one card: the card follows the finger a little while it
 * drags, and a swipe past the threshold calls `onSwipe('left' | 'right')`.
 * Vertical gestures and small wobbles are left alone, so a tap still taps and
 * the page still scrolls. The click a browser sends after a drag is swallowed,
 * so a swipe never also opens the card. Pointer events cover touch on the
 * kiosk WebView and the mouse in tests.
 *
 * Returns the handlers for the card, its follow offset in px, and whether a
 * drag is under way (the card animates back only once it is not).
 */
export default function useCardSwipe({ enabled, onSwipe }) {
  const start = useRef(null);
  const swallowUntil = useRef(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => { start.current = null; setOffset(0); setDragging(false); };

  const onPointerDown = (event) => {
    if (!enabled || (event.button !== undefined && event.button > 0)) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId, axis: null };
  };

  const onPointerMove = (event) => {
    const at = start.current;
    if (!at || at.id !== event.pointerId) return;
    const dx = event.clientX - at.x;
    const dy = event.clientY - at.y;
    if (!at.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      at.axis = Math.abs(dx) > Math.abs(dy) * MOSTLY ? 'x' : 'y';
      if (at.axis === 'x') {
        // Keep the finger's moves even when it leaves the card.
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
        setDragging(true);
      }
    }
    if (at.axis !== 'x') return;
    setOffset(Math.max(-FOLLOW_CAP, Math.min(FOLLOW_CAP, dx / 2)));
  };

  const onPointerUp = (event) => {
    const at = start.current;
    if (!at || at.id !== event.pointerId) return;
    const dx = event.clientX - at.x;
    const dy = event.clientY - at.y;
    const sideways = at.axis === 'x';
    reset();
    if (!sideways) return;
    // A drag, swipe or not, is not a tap.
    swallowUntil.current = Date.now() + CLICK_WINDOW;
    if (enabled && Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * MOSTLY) onSwipe(dx < 0 ? 'left' : 'right');
  };

  const onClickCapture = (event) => {
    if (Date.now() < swallowUntil.current) {
      swallowUntil.current = 0;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset, onClickCapture },
    offset,
    dragging,
  };
}
