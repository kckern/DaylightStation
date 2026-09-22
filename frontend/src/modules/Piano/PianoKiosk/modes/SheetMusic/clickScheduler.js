// clickScheduler.js — lookahead metronome beat scheduler ("a tale of two clocks").
//
// A coarse setInterval wakes every ~100 ms and schedules, via WebAudio, every
// beat that falls inside the next `lookaheadS` seconds — each at an exact
// AudioContext-clock time. Already-scheduled oscillators play from the audio
// thread, so click timing is sample-accurate no matter how badly the main
// thread janks (2026-07-06 decoupling audit T3). Never compute "now + period":
// beat times accumulate as t0 + n·period on the audio clock, so timer jitter
// can't drift the pulse.
//
// Anchored mode (start(bpm, { anchorEpochMs, leadMs })): instead of "first beat
// 80 ms from now", beat n lands at the EPOCH time anchorEpochMs + n·period -
// leadMs, so the click is locked to a Date.now()-based grading clock and played
// early by the measured output latency (see clickLead.js). The epoch → audio
// clock mapping is taken once at start:
//   - ac.getOutputTimestamp() when it returns a sane pair: {contextTime,
//     performanceTime} is "this sample is leaving the speaker at this moment",
//     so the mapping already includes the browser's own output latency;
//   - else ac.currentTime paired with Date.now() sampled together. When the
//     context HAS getOutputTimestamp but it is not reporting yet (a context that
//     has not rendered a frame returns zeros), outputLatency + baseLatency are
//     subtracted so the mapping means the same thing as the output-timestamp one.
// Beats already in the past are skipped but n keeps counting, so phase and the
// measure accent stay on the grid.

import { audioContext, scheduleBlipAt } from './click.js';

export function createClickScheduler({
  getCtx = audioContext,
  scheduleBlip = scheduleBlipAt,
  lookaheadS = 0.3,
  tickMs = 100,
  now = () => Date.now(),
  timeOrigin = () => globalThis.performance?.timeOrigin,
} = {}) {
  let timer = null;
  let nextBeat = 0;   // AudioContext-clock time of the next unscheduled beat
  let periodS = 0.5;
  let beatsPerBar = 0;
  let beatIndex = 0;

  const tick = () => {
    const ac = getCtx();
    if (!ac) return;
    const horizon = ac.currentTime + lookaheadS;
    while (nextBeat < horizon) {
      scheduleBlip(ac, nextBeat, { accent: beatsPerBar > 0 && beatIndex === 0 });
      nextBeat += periodS;
      if (beatsPerBar > 0) beatIndex = (beatIndex + 1) % beatsPerBar;
    }
  };

  return {
    start(bpm, options = {}) {
      if (!(bpm > 0)) return; // guard: bpm<=0 → negative period → tick loops forever
      const ac = getCtx();
      if (!ac) return; // no WebAudio (jsdom) — silent no-op, same as playClick
      if (ac.state === 'suspended') ac.resume();
      periodS = 60 / bpm;
      const delay = Number.isFinite(options.firstBeatDelayS) ? Math.max(0, options.firstBeatDelayS) : 0.08;
      beatsPerBar = Number.isFinite(options.beatsPerBar) && options.beatsPerBar > 0
        ? Math.round(options.beatsPerBar)
        : 0;
      beatIndex = beatsPerBar > 0
        ? ((Math.round(options.firstBeatIndex || 0) % beatsPerBar) + beatsPerBar) % beatsPerBar
        : 0;
      let info = { anchored: false };
      if (Number.isFinite(options.anchorEpochMs)) {
        const leadMs = Number.isFinite(options.leadMs) ? options.leadMs : 0;
        const map = epochToContextMap(ac, { now, timeOrigin });
        const beat0 = map.toContext(options.anchorEpochMs - leadMs);
        // First beat not already in the past; n keeps counting from beat 0.
        const skipped = Math.max(0, Math.ceil((ac.currentTime - beat0) / periodS - 1e-9));
        nextBeat = beat0 + skipped * periodS;
        if (beatsPerBar > 0) beatIndex = (beatIndex + skipped) % beatsPerBar;
        info = { anchored: true, mapping: map.mapping, skipped, leadMs, firstBeatContextTime: nextBeat };
      } else {
        nextBeat = ac.currentTime + delay;
      }
      tick();
      timer = setInterval(tick, tickMs);
      return info;
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

/**
 * Map epoch ms onto an AudioContext's clock. Returns { toContext(epochMs) →
 * context seconds, mapping } where mapping names the source used:
 * 'output-timestamp' | 'current-time+latency' | 'current-time'.
 */
export function epochToContextMap(ac, { now = () => Date.now(), timeOrigin = () => globalThis.performance?.timeOrigin } = {}) {
  const nowEpoch = now();
  const nowCtx = ac.currentTime;
  const hasOutputTimestamp = typeof ac.getOutputTimestamp === 'function';
  if (hasOutputTimestamp) {
    let ts = null;
    try { ts = ac.getOutputTimestamp(); } catch { ts = null; }
    const origin = timeOrigin();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0 && Number.isFinite(origin)) {
      const refEpoch = origin + ts.performanceTime;
      const refCtx = ts.contextTime;
      const toContext = (epochMs) => refCtx + (epochMs - refEpoch) / 1000;
      // Sanity: the output clock should sit within a second of the render
      // clock. A stale or garbage pair falls through to the paired fallback.
      if (Math.abs(toContext(nowEpoch) - nowCtx) < 1) return { toContext, mapping: 'output-timestamp' };
    }
  }
  const latencyS = hasOutputTimestamp ? (Number(ac.outputLatency) || 0) + (Number(ac.baseLatency) || 0) : 0;
  return {
    toContext: (epochMs) => nowCtx + (epochMs - nowEpoch) / 1000 - latencyS,
    mapping: latencyS > 0 ? 'current-time+latency' : 'current-time',
  };
}

export default createClickScheduler;
