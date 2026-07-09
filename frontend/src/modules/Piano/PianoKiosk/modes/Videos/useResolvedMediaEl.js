// useResolvedMediaEl.js
import { useState, useEffect } from 'react';

/**
 * Polls the Player imperative ref for its <video>/<audio> element and keeps it
 * fresh. The shared Player creates the element asynchronously AND may swap it
 * (resilience soft-reinit / remount, sometimes via a transient null gap); if we
 * resolved only once, a consumer's listeners would stay bound to a dead element
 * (stale `playing`). So we keep a lightweight poll running and re-emit whenever
 * the element identity changes.
 *
 * Returns { el, timedOut }. `timedOut` latches true only if no element has EVER
 * appeared within timeoutMs; once any element is found it never latches again,
 * and polling continues so a later swap re-resolves.
 */
export default function useResolvedMediaEl(playerRef, timeoutMs = 8000) {
  const [state, setState] = useState({ el: null, timedOut: false });
  useEffect(() => {
    let elapsed = 0;
    const STEP = 100;
    let current = null;
    let everResolved = false;
    const tick = () => {
      const m = playerRef?.current?.getMediaElement?.() || null;
      if (m !== current) {
        current = m;
        if (m) everResolved = true;
        setState({ el: m, timedOut: false });
        return;
      }
      if (!current && !everResolved) {
        elapsed += STEP;
        if (elapsed >= timeoutMs) setState((s) => (s.timedOut ? s : { el: null, timedOut: true }));
      }
    };
    tick(); // Call immediately for instant resolution
    const id = setInterval(tick, STEP);
    return () => clearInterval(id);
  }, [playerRef, timeoutMs]);
  return state;
}
