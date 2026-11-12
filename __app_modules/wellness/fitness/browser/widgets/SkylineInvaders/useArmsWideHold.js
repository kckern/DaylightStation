import { useEffect, useRef, useState } from 'react';

const POLL_MS = 100;

/**
 * The hands-free "press": both arms held out to the sides for `holdMs`. It is
 * the one gesture that is not an aiming posture and never needs the arms
 * overhead. `onHeld` runs once per hold; the arms must come down before it
 * can run again, and a pose that is already wide when the screen appears does
 * not count until it has been released once.
 *
 * @param {{ presence: () => { wide: boolean|null } }|null} tracker
 * @returns {number} hold progress 0..1, for the button to show
 */
export default function useArmsWideHold(tracker, active, onHeld, { holdMs = 1000 } = {}) {
  const latest = useRef(onHeld);
  latest.current = onHeld;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active || !tracker?.presence) { setProgress(0); return undefined; }
    let armed = false;
    let since = null;
    const timer = setInterval(() => {
      const wide = tracker.presence().wide === true;
      if (!wide) { armed = true; since = null; setProgress(0); return; }
      if (!armed) return;
      const now = Date.now();
      since ??= now;
      const held = Math.min(1, (now - since) / holdMs);
      setProgress(held);
      if (held >= 1) { armed = false; since = null; setProgress(0); latest.current?.(); }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, tracker, holdMs]);

  return progress;
}
