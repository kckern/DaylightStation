// useABLoop.js
import { useState, useRef, useEffect, useCallback } from 'react';
import { resolveLoopSeek } from './abLoop.js';

/**
 * Wires A/B marks to the media element: loops back to A when playback passes B.
 * The loop has a separate `enabled` flag so it can be toggled OFF (looping stops)
 * and back ON (the same A/B points are restored). Marking A or B changes the
 * points; only `clear()` wipes them.
 */
export default function useABLoop(mediaEl, seek, getCurrentTime) {
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const aRef = useRef(null); const bRef = useRef(null); const enRef = useRef(true);
  useEffect(() => { aRef.current = a; }, [a]);
  useEffect(() => { bRef.current = b; }, [b]);
  useEffect(() => { enRef.current = enabled; }, [enabled]);

  useEffect(() => {
    if (!mediaEl) return undefined;
    const onTime = () => {
      if (!enRef.current) return;
      const target = resolveLoopSeek(mediaEl.currentTime, aRef.current, bRef.current);
      if (target != null) seek(target);
    };
    mediaEl.addEventListener('timeupdate', onTime);
    return () => mediaEl.removeEventListener('timeupdate', onTime);
  }, [mediaEl, seek]);

  const markA = useCallback(() => { setA(getCurrentTime?.() ?? 0); setEnabled(true); }, [getCurrentTime]);
  const markB = useCallback(() => { setB(getCurrentTime?.() ?? 0); setEnabled(true); }, [getCurrentTime]);
  const toggle = useCallback(() => setEnabled((e) => !e), []);
  const clear = useCallback(() => { setA(null); setB(null); setEnabled(true); }, []);
  const active = enabled && a != null && b != null && b > a;
  return { a, b, enabled, active, markA, markB, toggle, clear };
}
