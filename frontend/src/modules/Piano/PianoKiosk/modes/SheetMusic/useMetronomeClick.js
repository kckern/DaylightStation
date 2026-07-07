import { useEffect, useRef } from 'react';
import { createClickScheduler } from './clickScheduler.js';

/**
 * useMetronomeClick — audio-clock metronome. While `enabled`, beats are
 * scheduled ahead on the AudioContext clock (see clickScheduler.js) so the
 * click stays locked under main-thread jank. bpm changes retune the period
 * live WITHOUT restarting (phase is kept).
 */
export function useMetronomeClick({ enabled, bpm, createScheduler = createClickScheduler }) {
  const schedRef = useRef(null);
  const bpmRef = useRef(bpm); bpmRef.current = bpm;

  useEffect(() => {
    if (!enabled || !(bpmRef.current > 0)) return undefined;
    const s = createScheduler();
    schedRef.current = s;
    s.start(bpmRef.current);
    return () => { s.stop(); schedRef.current = null; };
  }, [enabled, createScheduler]);

  useEffect(() => { if (bpm > 0) schedRef.current?.setBpm(bpm); }, [bpm]);
}

export default useMetronomeClick;
