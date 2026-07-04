// loopScheduler — pure event-builder for multitrack loop playback. Turns a
// canonical loop's notes into timed { t, type, note, velocity, channel } events
// for the kiosk's existing `scheduleNotes(events, channel)` (t = ms from
// schedule call). Per-layer channel + gain; shared bpm + per-layer transpose.
// No DOM, no timers — the React transport hook owns the rAF loop and
// re-schedules each cycle.

/** ms for a tick span at a given tempo. */
function ticksToMs(ticks, ppq, bpm) {
  const beats = ticks / ppq;
  return beats * (60000 / bpm);
}

/** Sanitize a MIDI channel to an integer 0..15. Never throws — events flow in
 * performance paths, so invalid input clamps/floors to a sane value (0). */
function sanitizeChannel(channel) {
  const n = Math.floor(Number(channel));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(15, n);
}

/**
 * Build scheduled events for one cycle of a loop.
 *
 * Gain semantics (v1): gain scales note_on velocity, clamped to 1..127 —
 * velocity-0 note_ons would read as note_offs downstream, so the floor is 1.
 * Gain is capped at 1 (attenuation only, no boost). Gain ≤ 0 means silent:
 * the layer emits NO events at all (neither ons nor offs).
 *
 * @param {Array<{ticks:number,durationTicks:number,midi:number}>} notes
 * @param {{ppq:number, bpm:number, transpose?:number, velocity?:number, cycleStartMs?:number, channel?:number, gain?:number}} opts
 */
export function loopToEvents(notes, opts) {
  const { ppq, bpm, transpose = 0, velocity = 90, cycleStartMs = 0, channel = 0, gain = 1 } = opts;
  const ch = sanitizeChannel(channel);
  // Non-numeric gain (null, 'x', …) falls back to 1 — Number(null) is 0, which
  // would silently mute the layer, so only finite numbers count as intent.
  const g = typeof gain === 'number' && Number.isFinite(gain) ? Math.min(1, gain) : 1;
  if (g <= 0) return []; // silent layer: skip ons AND offs entirely
  const onVelocity = Math.max(1, Math.min(127, Math.round(velocity * g)));
  const events = [];
  for (const n of notes) {
    const onMs = cycleStartMs + ticksToMs(n.ticks, ppq, bpm);
    const offMs = onMs + ticksToMs(n.durationTicks, ppq, bpm);
    const note = n.midi + transpose;
    events.push({ t: onMs, type: 'note_on', note, velocity: onVelocity, channel: ch });
    events.push({ t: offMs, type: 'note_off', note, velocity: 0, channel: ch });
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

/** Harmonic cycle length in ms: barSpan bars when known, else the note-derived
 * length. Exported for arrangementScheduler, which forces section lengths but
 * must tile layers by the exact same natural-length rule. */
export function layerLengthMs(layer, bpm, timeSig) {
  const { beats = 4, beatType = 4 } = timeSig || {};
  if (layer.barSpan) {
    const barMs = (60000 / bpm) * (4 / beatType) * beats;
    return layer.barSpan * barMs;
  }
  const ticks = loopLengthTicks(layer.notes, layer.ppq, timeSig);
  return (ticks * 60000) / (bpm * layer.ppq);
}

/** One bar in ms for a bpm + time signature ({beats,beatType}). */
export function barLengthMs(bpm, timeSig) {
  const { beats = 4, beatType = 4 } = timeSig || {};
  return (60000 / bpm) * (4 / beatType) * beats;
}

/**
 * Truncate a time-sorted event stream at `lengthMs`:
 * - note_ons at or beyond the boundary are dropped (the boundary instant
 *   belongs to the next pass of the loop, not this one);
 * - note_offs whose note_on was dropped are dropped too;
 * - note_offs beyond the boundary whose note_on was KEPT are moved to exactly
 *   the boundary — no stuck notes;
 * - note_offs at or before the boundary pass through untouched.
 * Pairing is by (note, channel) open-count, so overlapping repeats of the same
 * pitch resolve in order. Shared by buildLoopCycle (forced length) and the
 * arrangementScheduler (section length).
 */
export function truncateEvents(events, lengthMs) {
  const out = [];
  const open = new Map(); // `${note}|${channel}` → count of kept, unclosed note_ons
  for (const e of events) {
    const key = `${e.note}|${e.channel}`;
    if (e.type === 'note_on') {
      if (e.t < lengthMs) {
        out.push(e);
        open.set(key, (open.get(key) || 0) + 1);
      }
    } else {
      const n = open.get(key) || 0;
      if (n > 0) {
        open.set(key, n - 1);
        out.push(e.t <= lengthMs ? e : { ...e, t: lengthMs });
      }
    }
  }
  return out;
}

/**
 * Merge & tile layers into one looped cycle of events for the transport.
 * Master length = the longest layer (whole bars); shorter layers tile to fill it
 * so everything stays phase-aligned. Muted layers are skipped. A gain-0 layer
 * emits no events but STILL occupies its bar span — silencing a layer must not
 * change the cycle length, or the remaining layers would jump phase.
 *
 * `opts.forceLengthBars` (design §4 — the settable loop length) overrides the
 * natural length: the cycle is exactly that many bars, shorter layers tile to
 * fill it, longer layers are truncated at the boundary (with synthesized
 * note_offs). Absent/≤0 → natural length, EXACT legacy behavior (round-tiling,
 * no truncation).
 * @param {Array<{notes:Array, ppq:number, transpose?:number, muted?:boolean, velocity?:number, barSpan?:number, channel?:number, gain?:number}>} layers
 * @param {{bpm:number, timeSig?:{beats:number,beatType:number}, forceLengthBars?:number}} opts
 * @returns {{events:Array, lengthMs:number}}
 */
export function buildLoopCycle(layers, opts) {
  const { bpm, timeSig, forceLengthBars } = opts;
  const active = layers.filter((l) => !l.muted && l.notes?.length);
  const lengths = active.map((l) => layerLengthMs(l, bpm, timeSig));
  const naturalMs = lengths.length ? Math.max(...lengths) : (60000 / bpm) * 4;
  const forced = Number(forceLengthBars);
  const useForce = Number.isFinite(forced) && forced > 0;
  const lengthMs = useForce ? forced * barLengthMs(bpm, timeSig) : naturalMs;

  const events = [];
  active.forEach((l, i) => {
    const layerLenMs = lengths[i];
    if (useForce) {
      // ceil-tile to cover the forced span, then truncate as one stream so a
      // note ringing across a tile boundary still pairs with its own off.
      const repeats = Math.max(1, Math.ceil(lengthMs / layerLenMs - 1e-9));
      const layerEvents = [];
      for (let r = 0; r < repeats; r += 1) {
        layerEvents.push(...loopToEvents(l.notes, {
          ppq: l.ppq, bpm, transpose: l.transpose || 0, velocity: l.velocity ?? 90,
          cycleStartMs: r * layerLenMs, channel: l.channel ?? 0, gain: l.gain ?? 1,
        }));
      }
      layerEvents.sort((a, b) => a.t - b.t);
      events.push(...truncateEvents(layerEvents, lengthMs));
    } else {
      const repeats = Math.max(1, Math.round(lengthMs / layerLenMs));
      for (let r = 0; r < repeats; r += 1) {
        events.push(...loopToEvents(l.notes, {
          ppq: l.ppq, bpm, transpose: l.transpose || 0, velocity: l.velocity ?? 90, cycleStartMs: r * layerLenMs,
          channel: l.channel ?? 0, gain: l.gain ?? 1,
        }));
      }
    }
  });
  events.sort((a, b) => a.t - b.t);
  return { events, lengthMs };
}

export default { loopToEvents, loopLengthTicks, layerLengthMs, barLengthMs, truncateEvents, buildLoopCycle };
