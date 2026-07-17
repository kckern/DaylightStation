// note.js — the Composer Note factory. One well-formed shape (spec §3).
import { pitchToMidi } from '#frontend/modules/MusicNotation/parseMusicXml.js';

// noteDivisions is generic duration math and now lives in the shared MusicNotation
// layer (duration.js). Re-exported here so existing `import { noteDivisions } from
// './note.js'` sites keep working.
export { noteDivisions } from '#frontend/modules/MusicNotation/duration.js';

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
