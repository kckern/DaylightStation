import { useState, useRef, useCallback, useEffect } from 'react';
import { audioContext, scheduleBlipAt } from './click.js';

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
const defaultScheduleBlip = (offsetS) => {
  const ac = audioContext();
  if (!ac) return; // no WebAudio (jsdom) — silent no-op
  if (ac.state === 'suspended') ac.resume();
  scheduleBlipAt(ac, ac.currentTime + Math.max(0, offsetS));
};

export function useCountIn({ onGo, scheduleBlip = defaultScheduleBlip } = {}) {
  const [active, setActive] = useState(false);
  const [beat, setBeat] = useState(0);
  const onGoRef = useRef(onGo); onGoRef.current = onGo;
  const scheduleBlipRef = useRef(scheduleBlip); scheduleBlipRef.current = scheduleBlip;
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const cancel = useCallback(() => { clear(); setActive(false); setBeat(0); }, [clear]);

  const start = useCallback(({ beats, periodMs }) => {
    clear();
    const n = Math.max(1, Math.floor(beats) || 1);
    const period = periodMs > 0 ? periodMs : 500;
    for (let i = 0; i < n; i++) scheduleBlipRef.current?.((i * period) / 1000); // all beats up front
    setActive(true);
    setBeat(1);
    let counted = 1;
    timerRef.current = setInterval(() => {
      counted += 1;
      if (counted > n) { // last beat's period elapsed → go
        clear();
        setActive(false);
        setBeat(0);
        onGoRef.current?.();
        return;
      }
      setBeat(counted);
    }, period);
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  return { active, beat, start, cancel };
}

export default useCountIn;
