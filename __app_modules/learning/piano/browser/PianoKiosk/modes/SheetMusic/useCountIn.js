import { useState, useRef, useCallback, useEffect } from 'react';
import { audioContext, scheduleBlipAt } from './click.js';
import { epochToContextMap } from './clickScheduler.js';

/**
 * useCountIn — a one-measure metronome count-in. `start({ beats, periodMs })`
 * schedules every audible blip up front on the AudioContext clock (sample-accurate,
 * jank-proof — same lookahead principle as clickScheduler) and runs a visual beat
 * counter; after the last beat's period elapses it fires `onGo` once so the caller
 * can start the transport. `cancel()` aborts (no onGo). Timers clear on unmount.
 *
 * @param {object} p
 * @param {() => void} p.onGo - fired once when the count-in completes
 * @param {(offsetS:number) => void} [p.scheduleBlip] - schedule a blip `offsetS`
 *   seconds into the future (injectable for tests; defaults to the WebAudio blip)
 */
const defaultScheduleBlip = (offsetS, at = null) => {
  const ac = audioContext();
  if (!ac) return; // no WebAudio (jsdom) — silent no-op
  if (ac.state === 'suspended') ac.resume();
  // Planned on the performance clock: map it through the output clock (the
  // metronome's epochToContextMap), so the blip is HEARD at that instant — not
  // the device's output latency later (~0.3 s on the piano tablet's speaker,
  // which put every Polish count a third of a second behind the grade, 2026-11-24).
  if (at && Number.isFinite(at.perfMs)) {
    const t = epochToContextMap(ac).toContext(epochOfPerf(at.perfMs) - (Number(at.leadMs) || 0));
    scheduleBlipAt(ac, Math.max(ac.currentTime, t));
    return;
  }
  scheduleBlipAt(ac, ac.currentTime + Math.max(0, offsetS));
};
/**
 * A performance.now() instant on the Date.now() clock the click mapping reads
 * (epochToContextMap pairs against Date.now()), so the two clocks never mix.
 */
export const epochOfPerf = (perfMs) => Date.now() + (perfMs - performance.now());

/**
 * How long after the press the count's first blip sounds: long enough that a
 * blip mapped onto the output clock is not already in the past (the output
 * clock runs the device's latency behind currentTime). 0 with no WebAudio.
 */
const START_DELAY_MS = 80;
function countStartDelayMs() {
  const ac = audioContext();
  if (!ac) return 0;
  const latencyMs = ((Number(ac.outputLatency) || 0) + (Number(ac.baseLatency) || 0)) * 1000;
  return Math.max(START_DELAY_MS, Math.ceil(latencyMs) + 30);
}

export function useCountIn({ onGo, scheduleBlip = defaultScheduleBlip } = {}) {
  const [active, setActive] = useState(false);
  const [beat, setBeat] = useState(0);
  const onGoRef = useRef(onGo); onGoRef.current = onGo;
  const scheduleBlipRef = useRef(scheduleBlip); scheduleBlipRef.current = scheduleBlip;
  const timerRef = useRef(null);
  const delayRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) { clearInterval(timerRef.current); timerRef.current = null; }
    if (delayRef.current != null) { clearTimeout(delayRef.current); delayRef.current = null; }
  }, []);

  const cancel = useCallback(() => { clear(); setActive(false); setBeat(0); }, [clear]);

  const start = useCallback(({ beats, periodMs, leadMs = 0 }) => {
    clear();
    const n = Math.max(1, Math.floor(beats) || 1);
    const period = periodMs > 0 ? periodMs : 500;
    // The whole count is planned on one clock: blip i at startPerf + i·period, the
    // run's first beat at startPerf + n·period (handed to onGo as `atPerfMs`), so a
    // late interval tick never moves the graded beat off the heard one.
    const delay = countStartDelayMs();
    const startPerf = performance.now() + delay;
    const goPerf = startPerf + n * period;
    for (let i = 0; i < n; i++) scheduleBlipRef.current?.((delay + i * period) / 1000, { perfMs: startPerf + i * period, leadMs }); // all beats up front
    setActive(true);
    setBeat(1);
    let counted = 1;
    // The visible count and the go run on the same start as the blips.
    const run = () => { timerRef.current = setInterval(() => {
      counted += 1;
      if (counted > n) { // last beat's period elapsed → go
        clear();
        setActive(false);
        setBeat(0);
        onGoRef.current?.({ atPerfMs: goPerf });
        return;
      }
      setBeat(counted);
    }, period); };
    if (delay > 0) delayRef.current = setTimeout(() => { delayRef.current = null; run(); }, delay);
    else run();
    return { goPerf };
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  return { active, beat, start, cancel };
}

export default useCountIn;
