// useResolvedMediaEl.js
import { useState, useEffect } from 'react';

/**
 * Polls the Player imperative ref until its <video>/<audio> element exists.
 * The shared Player creates the media element asynchronously (lazy + resilience
 * controller), so getMediaElement() may be null on the first render.
 *
 * Returns { el, timedOut }. If the element never mounts within timeoutMs,
 * timedOut will be true and el will remain null so the UI can offer an escape
 * instead of staying silently dead.
 */
export default function useResolvedMediaEl(playerRef, timeoutMs = 8000) {
  const [state, setState] = useState({ el: null, timedOut: false });
  useEffect(() => {
    let elapsed = 0;
    const STEP = 100;
    let id;
    const tick = () => {
      const m = playerRef?.current?.getMediaElement?.();
      if (m) { setState({ el: m, timedOut: false }); return; }
      elapsed += STEP;
      if (elapsed >= timeoutMs) { setState({ el: null, timedOut: true }); return; }
      id = setTimeout(tick, STEP);
    };
    tick();
    return () => clearTimeout(id);
  }, [playerRef, timeoutMs]);
  return state;
}
