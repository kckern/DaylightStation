// useResolvedMediaEl.js
import { useState, useEffect } from 'react';

/**
 * Polls the Player imperative ref until its <video>/<audio> element exists.
 * The shared Player creates the media element asynchronously (lazy + resilience
 * controller), so getMediaElement() may be null on the first render.
 */
export default function useResolvedMediaEl(playerRef) {
  const [el, setEl] = useState(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const m = playerRef?.current?.getMediaElement?.();
      if (m) { setEl(m); return; }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playerRef]);
  return el;
}
