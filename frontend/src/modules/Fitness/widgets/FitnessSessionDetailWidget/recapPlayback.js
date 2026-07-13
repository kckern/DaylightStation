import { useEffect, useRef, useState } from 'react';

/**
 * Pure decision: should the in-slot recap loop play right now?
 * @param {{ enabled: boolean, prefersReducedMotion: boolean }} o
 * @returns {boolean}
 */
export function shouldPlayRecap({ enabled, prefersReducedMotion }) {
  return !!enabled && !prefersReducedMotion;
}

/**
 * Gate in-slot recap playback: play only after the selection settles (so tapping
 * down the session list doesn't strobe restarting loops) and never under
 * prefers-reduced-motion. Attach the returned ref to the <video>.
 * @param {{ enabled: boolean, delayMs?: number }} opts
 * @returns {{ videoRef: import('react').RefObject<HTMLVideoElement>, playing: boolean }}
 */
export function useSettledRecapPlay({ enabled, delayMs = 400 }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
    const prefersReducedMotion = typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!shouldPlayRecap({ enabled, prefersReducedMotion })) return undefined;
    const t = setTimeout(() => setPlaying(true), delayMs);
    return () => clearTimeout(t);
  }, [enabled, delayMs]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) el.play?.().catch(() => {});
    else el.pause?.();
  }, [playing]);

  return { videoRef, playing };
}
