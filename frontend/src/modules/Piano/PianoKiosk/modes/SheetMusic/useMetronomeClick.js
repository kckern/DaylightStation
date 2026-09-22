import { useEffect, useRef } from 'react';
import { createClickScheduler } from './clickScheduler.js';

/**
 * useMetronomeClick — audio-clock metronome. While `enabled`, beats are
 * scheduled ahead on the AudioContext clock (see clickScheduler.js) so the
 * click stays locked under main-thread jank. bpm changes retune the period
 * live WITHOUT restarting (phase is kept).
 *
 * Anchored grid: pass `anchorMs` (epoch ms of beat 0, on the same Date.now()
 * clock the grader uses) and optionally `leadMs` (play this much early to cover
 * output latency — see resolveClickLead in clickLead.js). Beats then land at
 * anchorMs + n·period - leadMs; `startDelayMs` is ignored. Changing anchorMs or
 * leadMs restarts the grid.
 */
export function useMetronomeClick({
  enabled,
  bpm,
  startDelayMs,
  beatsPerBar,
  firstBeatIndex,
  anchorMs,
  leadMs,
  createScheduler = createClickScheduler,
}) {
  const schedRef = useRef(null);
  const bpmRef = useRef(bpm); bpmRef.current = bpm;
  const startOptionsRef = useRef(null);
  const anchored = Number.isFinite(anchorMs);
  const anchor = anchored ? anchorMs : null;
  const lead = anchored && Number.isFinite(leadMs) ? leadMs : 0;
  startOptionsRef.current = anchored
    ? {
        anchorEpochMs: anchorMs,
        leadMs: lead,
        ...(Number.isFinite(beatsPerBar) ? { beatsPerBar } : {}),
        ...(Number.isFinite(firstBeatIndex) ? { firstBeatIndex } : {}),
      }
    : Number.isFinite(startDelayMs) || Number.isFinite(beatsPerBar)
    ? {
        ...(Number.isFinite(startDelayMs) ? { firstBeatDelayS: Math.max(0, startDelayMs) / 1000 } : {}),
        ...(Number.isFinite(beatsPerBar) ? { beatsPerBar } : {}),
        ...(Number.isFinite(firstBeatIndex) ? { firstBeatIndex } : {}),
      }
    : null;

  useEffect(() => {
    if (!enabled || !(bpmRef.current > 0)) return undefined;
    const s = createScheduler();
    schedRef.current = s;
    if (startOptionsRef.current) s.start(bpmRef.current, startOptionsRef.current);
    else s.start(bpmRef.current);
    return () => { s.stop(); schedRef.current = null; };
  }, [enabled, createScheduler, anchor, lead]);

  useEffect(() => { if (bpm > 0) schedRef.current?.setBpm(bpm); }, [bpm]);
}

export default useMetronomeClick;
