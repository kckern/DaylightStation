// pianoTestStream.js — deterministic MIDI-note stream generator for the paint
// test harness. Produces the SAME { history, active } shapes the live
// useMidiSubscription builds, by reusing the real noteHistory helpers — so the
// NoteWaterfall + PianoKeyboard render (and thus paint) exactly as in production.
// No WebSocket, no physical keyboard: feed it a clock and it simulates playing.
import { handleNoteOn, handleNoteOff, trimHistory } from '../../../noteHistory.js';

/** Defaults tuned to reproduce a dense "vengeance" passage on the kiosk. */
export const TEST_DEFAULTS = { scene: 'full', nps: 12, poly: 8, holdMs: 450, lo: 36, hi: 96, seed: 1, dur: 0 };

/** mulberry32 — tiny deterministic RNG so a given seed yields a stable stream. */
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh simulation state for the given params. */
export function createSimState(params) {
  return {
    history: [],          // noteHistory array: { note, velocity, startTime, endTime }
    active: new Map(),     // note -> { velocity, timestamp } (mirrors useMidiSubscription)
    offs: [],              // scheduled note-offs: { note, at }
    rng: makeRng(params.seed ?? 1),
    nextOnAt: null,        // ms timestamp of the next note-on to fire
  };
}

/**
 * Advance the simulation to absolute time `now` (ms, e.g. Date.now()). Fires any
 * due note-ons (capped at `poly` simultaneous), closes any due note-offs, and
 * trims the history to the display window. Mutates and returns `state`.
 */
export function stepSim(state, now, params) {
  const nps = Math.max(1, params.nps);
  const poly = Math.max(1, params.poly);
  const holdMs = Math.max(1, params.holdMs);
  const lo = params.lo;
  const hi = Math.max(params.lo + 1, params.hi);
  const interval = 1000 / nps;

  if (state.nextOnAt == null) state.nextOnAt = now;

  // Close notes whose hold has elapsed.
  const pending = [];
  for (const off of state.offs) {
    if (off.at <= now) {
      state.history = handleNoteOff(state.history, off.note, off.at);
      state.active.delete(off.note);
    } else {
      pending.push(off);
    }
  }
  state.offs = pending;

  // Fire note-ons that are due, up to the polyphony cap.
  let guard = 0;
  while (state.nextOnAt <= now && guard++ < 512) {
    if (state.active.size < poly) {
      const note = lo + Math.floor(state.rng() * (hi - lo));
      if (!state.active.has(note)) {
        const velocity = Math.round((0.5 + state.rng() * 0.5) * 127);
        state.history = handleNoteOn(state.history, note, velocity, state.nextOnAt);
        state.active.set(note, { velocity, timestamp: state.nextOnAt });
        state.offs.push({ note, at: state.nextOnAt + holdMs });
      }
    }
    state.nextOnAt += interval;
  }

  state.history = trimHistory(state.history, now);
  return state;
}
