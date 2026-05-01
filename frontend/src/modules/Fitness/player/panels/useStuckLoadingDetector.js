import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Tracks how long the music player has been "loading" (no currentTrack while a
 * playlist is selected) and flips isStuck=true once thresholdMs elapses.
 *
 * Inputs:
 *   hasTrack    boolean — true when currentTrack is non-null
 *   playlistId  string|null — the selected playlist; when null, detector idles
 *   thresholdMs number — how long to wait before declaring stuck (default 15 s)
 *
 * Output:
 *   isStuck  boolean — true once the threshold has elapsed without a track
 *   attempt  number  — increments on each retry()
 *   retry()  function — resets isStuck, restarts the threshold timer, bumps attempt
 *
 * The attempt counter is intended to be woven into the inner <Player>'s React
 * `key` so a retry forces a clean remount.
 */
export function useStuckLoadingDetector({ hasTrack, playlistId, thresholdMs = 15_000 }) {
  const [isStuck, setIsStuck] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    // Idle conditions: no playlist selected OR a track is already playing.
    if (!playlistId || hasTrack) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (isStuck) setIsStuck(false);
      return undefined;
    }

    // Already stuck — don't restart timer (only retry() does that).
    if (isStuck) return undefined;

    // Arm threshold timer.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setIsStuck(true);
    }, thresholdMs);

    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [playlistId, hasTrack, thresholdMs, isStuck, attempt]);

  const retry = useCallback(() => {
    setIsStuck(false);
    setAttempt((n) => n + 1);
  }, []);

  return { isStuck, attempt, retry };
}
