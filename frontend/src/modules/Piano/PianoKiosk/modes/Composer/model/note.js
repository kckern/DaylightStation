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
    // Carry a parsed non-3:2 `tuplet` through opts (finding C5). Without this, any
    // rebuild via makeNote(pitch, {...old}) (replacePitch/nudgePitch) DROPS it, so
    // the serializer's #7 non-3:2 guard no longer fires and the note serializes
    // corrupt. undefined when absent (Composer-created notes never set it).
    tuplet: opts.tuplet,
    staff: opts.staff ?? 1, voice: opts.voice ?? 1,
    lyric: opts.lyric, dynamics: opts.dynamics, articulations: opts.articulations,
  };
}

export function makeRest(opts = {}) {
  return {
    rest: true, type: opts.type ?? 'quarter', dots: opts.dots ?? 0,
    triplet: opts.triplet ?? false,
    // The parser attaches `tuplet` to ANY <note> with <time-modification>, rests
    // included, so a rest inside a non-3:2 tuplet group carries it. Preserve it
    // through makeRest for the same reason as makeNote (C5): rebuildDuration rebuilds
    // rests via makeRest({...note}), and dropping tuplet would disarm the #7 guard.
    tuplet: opts.tuplet,
    staff: opts.staff ?? 1, voice: opts.voice ?? 1,
    // Rests can carry expressive annotations too (a dynamic/lyric can sit on a
    // rest). Spread them like makeNote so rebuildDuration/toggleDot on an annotated
    // rest doesn't silently destroy them (finding #6).
    lyric: opts.lyric, dynamics: opts.dynamics, articulations: opts.articulations,
  };
}
