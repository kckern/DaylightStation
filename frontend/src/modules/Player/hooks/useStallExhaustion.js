import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Track how long a stall has lasted. Flip `exhausted=true` when the stall
 * exceeds `thresholdMs` continuously. Reset when stall ends or `dismiss()`
 * is called. Used by the "Tap to restart" banner.
 */
export function useStallExhaustion({ stalled, thresholdMs = 15000 }) {
  const [exhausted, setExhausted] = useState(false);
  const [secondsStalled, setSecondsStalled] = useState(0);
  const startRef = useRef(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!stalled) {
      startRef.current = null;
      dismissedRef.current = false;
      setExhausted(false);
      setSecondsStalled(0);
      return undefined;
    }
    if (!startRef.current) startRef.current = Date.now();
    const tick = () => {
      if (dismissedRef.current) return;
      const elapsed = Date.now() - startRef.current;
      setSecondsStalled(Math.floor(elapsed / 1000));
      if (elapsed >= thresholdMs) setExhausted(true);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [stalled, thresholdMs]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setExhausted(false);
  }, []);

  return { exhausted, secondsStalled, dismiss };
}
