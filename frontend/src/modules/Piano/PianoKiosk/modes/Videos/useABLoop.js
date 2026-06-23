// useABLoop.js
import { useState, useRef, useEffect, useCallback } from 'react';
import { resolveLoopSeek } from './abLoop.js';

/** Wires A/B marks to the media element: loops back to A when playback passes B. */
export default function useABLoop(mediaEl, seek, getCurrentTime) {
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const aRef = useRef(null); const bRef = useRef(null);
  useEffect(() => { aRef.current = a; }, [a]);
  useEffect(() => { bRef.current = b; }, [b]);

  useEffect(() => {
    if (!mediaEl) return undefined;
    const onTime = () => {
      const target = resolveLoopSeek(mediaEl.currentTime, aRef.current, bRef.current);
      if (target != null) seek(target);
    };
    mediaEl.addEventListener('timeupdate', onTime);
    return () => mediaEl.removeEventListener('timeupdate', onTime);
  }, [mediaEl, seek]);

  const markA = useCallback(() => setA(getCurrentTime?.() ?? 0), [getCurrentTime]);
  const markB = useCallback(() => setB(getCurrentTime?.() ?? 0), [getCurrentTime]);
  const clear = useCallback(() => { setA(null); setB(null); }, []);
  return { a, b, markA, markB, clear };
}
