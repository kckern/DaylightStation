import { useCallback, useEffect, useRef } from 'react';

export function useWebcamSnapshots({
  enabled = false,
  intervalMs = 0,
  videoElement,
  canvasElement,
  makeSnapshot,
  onSnapshot,
  onError,
}) {
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(async () => {
    if (!enabled || !makeSnapshot) return;
    try {
      const result = await makeSnapshot();
      if (result && onSnapshot) {
        onSnapshot(result.meta, result.blob);
      }
    } catch (err) {
      onError?.(err);
    }
  }, [enabled, makeSnapshot, onSnapshot, onError]);

  useEffect(() => {
    clearTimer();
    if (!enabled) return undefined;
    if (!intervalMs || intervalMs <= 0) return undefined;
    timerRef.current = setInterval(tick, intervalMs);
    return () => clearTimer();
  }, [enabled, intervalMs, tick, clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { triggerSnapshot: tick };
}
