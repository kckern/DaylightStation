import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Drives automatic recovery for the music player. When a playlist is selected
 * but no track is playing — either because the load silently stalled, or
 * because a recoverable error (a transient queue-fetch failure) occurred — this
 * hook automatically retries the load up to `maxAutoRetries` times before
 * giving up.
 *
 * `attempt` is woven into the inner <Player>'s React key so each retry forces a
 * clean remount, which re-fetches the queue. The music source is always
 * available, so a stall is a client-side resolution failure that self-heals on
 * retry; only after the retry budget is spent do we surface a manual affordance.
 *
 * Inputs:
 *   hasTrack          boolean — true when a track is actually playing
 *   playlistId        string|number|null — selected playlist; null => idle
 *   recoverableError  boolean — true when the current error is worth retrying
 *   thresholdMs       number  — silent-stall detection window (default 15 s)
 *   retryDelayMs      number  — pause before an auto-retry (default 1 s)
 *   maxAutoRetries    number  — automatic attempts before exhaustion (default 3)
 *
 * Output:
 *   attempt       number   — increments on each retry (manual or automatic)
 *   isRecovering  boolean  — true while loading/retrying (UI shows "Loading…")
 *   exhausted     boolean  — true once auto-retries are spent and still no track
 *   retry()       function — manual retry: resets the budget and bumps attempt
 */
export function useMusicRecovery({
  hasTrack,
  playlistId,
  recoverableError = false,
  thresholdMs = 15_000,
  retryDelayMs = 1_000,
  maxAutoRetries = 3,
}) {
  const [attempt, setAttempt] = useState(0);
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const stallTimerRef = useRef(null);
  const retryTimerRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }, []);

  // A track is playing → fully reset the recovery budget.
  useEffect(() => {
    if (!hasTrack) return;
    clearTimers();
    if (autoRetryCount !== 0) setAutoRetryCount(0);
    if (exhausted) setExhausted(false);
  }, [hasTrack, autoRetryCount, exhausted, clearTimers]);

  // Failure detection + bounded auto-retry.
  useEffect(() => {
    if (!playlistId || hasTrack || exhausted) {
      clearTimers();
      return undefined;
    }

    const scheduleAutoRetry = () => {
      if (autoRetryCount >= maxAutoRetries) {
        setExhausted(true);
        return;
      }
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setAutoRetryCount((n) => n + 1);
        setAttempt((n) => n + 1);
      }, retryDelayMs);
    };

    if (recoverableError) {
      // The error already proves the load failed — retry without the full wait.
      scheduleAutoRetry();
    } else {
      // Silent stall — wait the detection window before retrying.
      stallTimerRef.current = setTimeout(scheduleAutoRetry, thresholdMs);
    }

    return clearTimers;
  }, [playlistId, hasTrack, exhausted, recoverableError, autoRetryCount, maxAutoRetries, thresholdMs, retryDelayMs, clearTimers]);

  const retry = useCallback(() => {
    setExhausted(false);
    setAutoRetryCount(0);
    setAttempt((n) => n + 1);
  }, []);

  const isRecovering = Boolean(playlistId) && !hasTrack && !exhausted;

  return { attempt, isRecovering, exhausted, retry };
}
