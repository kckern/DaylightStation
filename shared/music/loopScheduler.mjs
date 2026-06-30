// loopScheduler — pure event-builder for multitrack loop playback. Turns a
// canonical loop's notes into timed { t, type, note, velocity } events for the
// kiosk's existing `scheduleNotes(events, channel)` (t = ms from schedule call).
// One channel per layer; shared bpm + per-layer transpose. No DOM, no timers —
// the React transport hook owns the rAF loop and re-schedules each cycle.

/** ms for a tick span at a given tempo. */
function ticksToMs(ticks, ppq, bpm) {
  const beats = ticks / ppq;
  return beats * (60000 / bpm);
}

/**
 * Build scheduled events for one cycle of a loop.
 * @param {Array<{ticks:number,durationTicks:number,midi:number}>} notes
 * @param {{ppq:number, bpm:number, transpose?:number, velocity?:number, cycleStartMs?:number}} opts
 */
export function loopToEvents(notes, opts) {
  const { ppq, bpm, transpose = 0, velocity = 90, cycleStartMs = 0 } = opts;
  const events = [];
  for (const n of notes) {
    const onMs = cycleStartMs + ticksToMs(n.ticks, ppq, bpm);
    const offMs = onMs + ticksToMs(n.durationTicks, ppq, bpm);
    const note = n.midi + transpose;
    events.push({ t: onMs, type: 'note_on', note, velocity });
    events.push({ t: offMs, type: 'note_off', note, velocity: 0 });
  }
  return events.sort((a, b) => a.t - b.t);
}

/**
 * Loop length rounded up to whole bars, so layers stay phase-aligned.
 * @param {Array<{ticks:number,durationTicks:number}>} notes
 * @param {number} ppq
 * @param {{beats:number,beatType:number}} timeSig
 */
export function loopLengthTicks(notes, ppq, timeSig = { beats: 4, beatType: 4 }) {
  const barTicks = ppq * (4 / timeSig.beatType) * timeSig.beats;
  const end = notes.reduce((max, n) => Math.max(max, n.ticks + (n.durationTicks || 0)), 0);
  const bars = Math.max(1, Math.ceil(end / barTicks));
  return bars * barTicks;
}

export default { loopToEvents, loopLengthTicks };
