// useResolvedMediaEl.js
import { useState, useEffect } from 'react';

/**
 * Polls the Player imperative ref for its <video>/<audio> element and keeps it
 * fresh. The shared Player creates the element asynchronously AND may swap it
 * (resilience soft-reinit / remount); if we resolved only once, a consumer's
 * listeners would stay bound to a dead element (stale `playing`). So we keep a
 * lightweight poll running and re-emit whenever the element identity changes.
 *
 * Returns { el, timedOut }. `timedOut` latches true only if no element appears
 * within timeoutMs while still unresolved.
 */
export default function useResolvedMediaEl(playerRef, timeoutMs = 8000) {
  const [state, setState] = useState({ el: null, timedOut: false });
  useEffect(() => {
    let elapsed = 0;
    const STEP = 100;
    let current = null;
    let id;
    const tick = () => {
      const m = playerRef?.current?.getMediaElement?.() || null;
      if (m !== current) {
        current = m;
        setState({ el: m, timedOut: false });
      }
      if (!current) {
        elapsed += STEP;
        if (elapsed >= timeoutMs) {
          setState((s) => (s.timedOut ? s : { el: null, timedOut: true }));
          return;
        }
      }
      id = setTimeout(tick, STEP);
    };
    tick();
    return () => clearTimeout(id);
  }, [playerRef, timeoutMs]);
  return state;
}
