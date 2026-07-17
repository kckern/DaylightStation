// note.js — the Composer Note factory. One well-formed shape (spec §3).
import { pitchToMidi } from '#frontend/modules/MusicNotation/parseMusicXml.js';

const BASE_DIVS = { whole: 96, half: 48, quarter: 24, eighth: 12, '16th': 6 };
const TRIPLET_FACTOR = 2 / 3;

/** Duration of a note/rest in divisions, honoring dots and triplet. */
export function noteDivisions(note) {
  let d = BASE_DIVS[note.type];
  if (note.dots) for (let i = 0; i < note.dots; i++) d *= 1.5;
  if (note.triplet) d *= TRIPLET_FACTOR;
  return Math.round(d);
}

export function makeNote(pitch, opts = {}) {
  const p = { step: pitch.step, octave: pitch.octave, alter: pitch.alter ?? 0 };
  return {
    rest: false, pitch: p, midi: pitchToMidi(p),
    type: opts.type ?? 'quarter', dots: opts.dots ?? 0, tie: opts.tie ?? null,
    triplet: opts.triplet ?? false, chord: opts.chord ?? false,
    staff: opts.staff ?? 1, voice: opts.voice ?? 1,
    lyric: opts.lyric, dynamics: opts.dynamics, articulations: opts.articulations,
  };
}

export function makeRest(opts = {}) {
  return {
    rest: true, type: opts.type ?? 'quarter', dots: opts.dots ?? 0,
    triplet: opts.triplet ?? false, staff: opts.staff ?? 1, voice: opts.voice ?? 1,
  };
}
