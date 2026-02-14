import { useState, useEffect, useRef } from 'react';

/**
 * Self-updating countdown hook that computes remaining seconds from a deadline timestamp.
 *
 * When notchCount is provided, uses requestAnimationFrame and only triggers re-renders
 * when the visible notch count changes — ideal for discrete step displays (life meters).
 *
 * When notchCount is omitted, uses a 1s setInterval for simple countdown displays.
 *
 * @param {number|null} deadline - Unix timestamp (ms) when countdown expires
 * @param {number} totalSeconds - Total duration for progress calculation (default: 30)
 * @param {number} [notchCount] - If provided, gate re-renders to notch boundary crossings
 * @returns {{ remaining: number|null, progress: number, isExpired: boolean }}
 */
const useDeadlineCountdown = (deadline, totalSeconds = 30, notchCount) => {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null
  );
  const lastNotchRef = useRef(-1);

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      lastNotchRef.current = -1;
      return;
    }

    // Notch-gated mode: use rAF, only setState on notch boundary change
    if (notchCount != null && notchCount > 0) {
      let rafId;
      const tick = () => {
        const rawSecs = Math.max(0, (deadline - Date.now()) / 1000);
        const notches = Math.round((rawSecs / totalSeconds) * notchCount);
        if (notches !== lastNotchRef.current) {
          lastNotchRef.current = notches;
          setRemaining(Math.round(rawSecs));
        }
        if (rawSecs > 0) {
          rafId = requestAnimationFrame(tick);
        }
      };
      // Reset so first frame always triggers
      lastNotchRef.current = -1;
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }

    // Legacy mode: 1s interval for simple countdown displays
    const update = () => {
      const secs = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(secs);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline, totalSeconds, notchCount]);

  const progress = (remaining != null && totalSeconds > 0)
    ? Math.max(0, Math.min(100, (remaining / totalSeconds) * 100))
    : 0;

  const isExpired = remaining != null && remaining <= 0;

  return { remaining, progress, isExpired };
};

export default useDeadlineCountdown;
