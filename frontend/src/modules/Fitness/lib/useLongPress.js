import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Distinguish a tap from a deliberate hold on one element.
 * - Release before holdMs → onTap(event)
 * - Held for holdMs      → onLongPress(event); the release does NOT also tap
 * - Pointer leave/cancel  → neither
 * The hold-then-fire pattern is its own confirmation: an accidental brush
 * can't trigger onLongPress. `holding` drives the visual hold indicator.
 */
export default function useLongPress({ onLongPress, onTap, holdMs = 2000 }) {
  const timerRef = useRef(null);
  const [holding, setHolding] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }, []);

  const onPointerDown = useCallback((event) => {
    // pointerdown implicitly captures the pointer to its target on touch
    // devices, so a finger sliding off never delivers pointerleave — the
    // abort path below would never run and a slide-off hold would still
    // fire onLongPress. Release the capture so real boundary events flow.
    try { event.target?.releasePointerCapture?.(event.pointerId); } catch (_) { /* non-pointer or already released */ }
    if (timerRef.current) clearTimeout(timerRef.current);
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onLongPress?.(event);
    }, holdMs);
  }, [onLongPress, holdMs]);

  const onPointerUp = useCallback((event) => {
    // A pending timer means the hold threshold wasn't reached — it's a tap.
    const wasPending = timerRef.current != null;
    clearTimer();
    if (wasPending) onTap?.(event);
  }, [clearTimer, onTap]);

  const onPointerLeave = useCallback(() => { clearTimer(); }, [clearTimer]);
  const onPointerCancel = useCallback(() => { clearTimer(); }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    holding,
    handlers: { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel }
  };
}
