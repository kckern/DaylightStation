import { useState, useEffect, useRef } from 'react';

/**
 * Self-updating countdown hook that computes remaining seconds from a deadline timestamp.
 *
 * When notchCount is provided, uses a per-notch interval timer that decrements exactly
 * one notch at a time — prevents skipping notches during rAF stalls (GPU/tab contention).
 *
 * When notchCount is omitted, uses a 1s setInterval for simple countdown displays.
 *
 * @param {number|null} deadline - Unix timestamp (ms) when countdown expires
 * @param {number} totalSeconds - Total duration for progress calculation (default: 30)
 * @param {number} [notchCount] - If provided, use per-notch interval timer
 * @returns {{ remaining: number|null, notches: number|null, progress: number, isExpired: boolean }}
 */
const useDeadlineCountdown = (deadline, totalSeconds = 30, notchCount) => {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null
  );
  const [notches, setNotches] = useState(() => {
    if (!deadline || !notchCount) return null;
    const secs = Math.max(0, (deadline - Date.now()) / 1000);
    return Math.min(notchCount, Math.max(0, Math.round((secs / totalSeconds) * notchCount)));
  });
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      setNotches(null);
      return;
    }

    // Notch-gated mode: per-notch interval timer, guaranteed one-at-a-time
    if (notchCount != null && notchCount > 0) {
      const msPerNotch = (totalSeconds * 1000) / notchCount;
      // Initialize from current time
      const initialSecs = Math.max(0, (deadline - Date.now()) / 1000);
      const initialNotches = Math.min(notchCount, Math.max(0, Math.round((initialSecs / totalSeconds) * notchCount)));
      setNotches(initialNotches);
      setRemaining(Math.round(initialSecs));

      if (initialNotches <= 0) return;

      intervalRef.current = setInterval(() => {
        setNotches(prev => {
          const next = (prev ?? 0) - 1;
          if (next <= 0) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            setRemaining(0);
            return 0;
          }
          // Derive remaining seconds from notch position for consistency
          setRemaining(Math.round((next / notchCount) * totalSeconds));
          return next;
        });
      }, msPerNotch);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
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

  return { remaining, notches, progress, isExpired };
};

export default useDeadlineCountdown;
