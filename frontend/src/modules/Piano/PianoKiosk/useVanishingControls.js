import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Plexamp-style auto-hiding chrome. Controls start visible; any activity reveals
 * them and (re)arms a hide timer. While `active` (playing), they fade after
 * `idleMs` of no activity. When not active, they stay visible.
 *
 * Default idle is a deliberately roomy 20s: the now-playing chrome is the primary
 * surface, so it should linger long enough to read and reach before dimming.
 */
export default function useVanishingControls({ active, idleMs = 20000 }) {
  const [visible, setVisible] = useState(true);
  const timer = useRef(null);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (active) timer.current = setTimeout(() => setVisible(false), idleMs);
  }, [active, idleMs]);

  const reveal = useCallback(() => {
    setVisible(true);
    arm();
  }, [arm]);

  useEffect(() => {
    arm();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [arm]);

  // Always show chrome while paused/stopped.
  useEffect(() => { if (!active) setVisible(true); }, [active]);

  return { visible, reveal };
}
