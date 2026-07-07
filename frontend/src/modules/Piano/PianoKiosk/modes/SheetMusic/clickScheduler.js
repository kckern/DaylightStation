// clickScheduler.js — lookahead metronome beat scheduler ("a tale of two clocks").
//
// A coarse setInterval wakes every ~100 ms and schedules, via WebAudio, every
// beat that falls inside the next `lookaheadS` seconds — each at an exact
// AudioContext-clock time. Already-scheduled oscillators play from the audio
// thread, so click timing is sample-accurate no matter how badly the main
// thread janks (2026-07-06 decoupling audit T3). Never compute "now + period":
// beat times accumulate as t0 + n·period on the audio clock, so timer jitter
// can't drift the pulse.

import { audioContext, scheduleBlipAt } from './click.js';

export function createClickScheduler({
  getCtx = audioContext,
  scheduleBlip = scheduleBlipAt,
  lookaheadS = 0.3,
  tickMs = 100,
} = {}) {
  let timer = null;
  let nextBeat = 0;   // AudioContext-clock time of the next unscheduled beat
  let periodS = 0.5;

  const tick = () => {
    const ac = getCtx();
    if (!ac) return;
    const horizon = ac.currentTime + lookaheadS;
    while (nextBeat < horizon) {
      scheduleBlip(ac, nextBeat);
      nextBeat += periodS;
    }
  };

  return {
    start(bpm) {
      if (!(bpm > 0)) return; // guard: bpm<=0 → negative period → tick loops forever
      const ac = getCtx();
      if (!ac) return; // no WebAudio (jsdom) — silent no-op, same as playClick
      if (ac.state === 'suspended') ac.resume();
      periodS = 60 / bpm;
      nextBeat = ac.currentTime + 0.08; // first click essentially immediately
      tick();
      timer = setInterval(tick, tickMs);
    },
    setBpm(bpm) {
      if (!(bpm > 0)) return;
      const newPeriod = 60 / bpm;
      // Keep phase: nextBeat was accumulated as lastScheduled + oldPeriod.
      // Re-anchor the next (still unscheduled) beat onto the new spacing so
      // the tempo change takes effect from the next beat, not from "now".
      nextBeat += newPeriod - periodS;
      periodS = newPeriod;
      // Avoid a past-timestamped catch-up burst on a big speed-up (e.g. 30→180).
      const now = getCtx()?.currentTime;
      if (now != null && nextBeat < now) nextBeat = now;
    },
    stop() { if (timer != null) { clearInterval(timer); timer = null; } },
  };
}

export default createClickScheduler;
