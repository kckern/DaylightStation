import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Track how long a continuous stall has lasted and flip `exhausted=true` after
 * `thresholdMs`. Reset state when the stall ends or `dismiss()` is called.
 *
 * Used by `PlayerOverlayStallExhausted` (the "Playback stuck" banner) so that
 * the banner appears only after a sustained recovery loop.
 *
 * **Dismiss semantics:**
 * - After `dismiss()`, `exhausted` becomes `false` and stays `false` for the
 *   rest of this stall episode, even if the stall continues past `thresholdMs`.
 * - `secondsStalled` freezes at the dismissed value (the UI is expected to
 *   stop rendering it post-dismiss).
 * - When the stall ends (`stalled` flips to `false`), all state including the
 *   dismiss flag resets. A subsequent stall starts a fresh episode.
 *
 * @param {object} args
 * @param {boolean} args.stalled - Whether the player is currently stalled.
 * @param {number} [args.thresholdMs=15000] - Continuous stall duration to flip
 *   `exhausted=true`.
 * @returns {{ exhausted: boolean, secondsStalled: number, dismiss: () => void }}
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
