import { useState, useEffect } from 'react';

/**
 * Self-updating countdown hook that computes remaining seconds from a deadline timestamp.
 * Only runs an interval when deadline is active. No manual controls needed.
 *
 * @param {number|null} deadline - Unix timestamp (ms) when countdown expires
 * @param {number} totalSeconds - Total duration for progress calculation (default: 30)
 * @returns {{ remaining: number|null, progress: number, isExpired: boolean }}
 */
const useDeadlineCountdown = (deadline, totalSeconds = 30) => {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null
  );

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      return;
    }

    const update = () => {
      const secs = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(secs);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  const progress = (remaining != null && totalSeconds > 0)
    ? Math.max(0, Math.min(100, (remaining / totalSeconds) * 100))
    : 0;

  const isExpired = remaining === 0;

  return { remaining, progress, isExpired };
};

export default useDeadlineCountdown;
