// Theory lesson engine — tonal-backed grading oracle for MIDI-interactive
// music-theory lessons. The piano kiosk feeds live MIDI (note numbers); tonal
// interprets/grades; MusicNotation renders the target/result.
//
// SKELETON: the grading primitives below are real and unit-tested, but the
// lesson *flow* (prompt sequencing, scoring, progression UI) is not built yet.
// See lessonTypes.js for the catalog these primitives back.

import { Chord, Scale, Interval, Note, Progression } from 'tonal';

/** MIDI note number → scientific name, e.g. 60 → "C4". */
export const midiToName = (midi) => Note.fromMidi(midi);

/** MIDI note number → pitch-class chroma (0..11), octave-independent. */
export const midiToChroma = (midi) => ((midi % 12) + 12) % 12;

/** Detect chord name(s) from a set of held MIDI notes. */
export function detectChords(midiNotes) {
  return Chord.detect(midiNotes.map(midiToName));
}

/** Pitch-class chroma set expected for a chord symbol, e.g. "Dm7". */
export function expectedChordChroma(symbol) {
  return new Set(Chord.get(symbol).notes.map(Note.chroma));
}

/**
 * Grade a held chord against a target symbol by pitch-class set equality
 * (order- and octave-independent).
 * @returns {{ correct, expected:number[], played:number[], detected:string[] }}
 */
export function gradeChord(symbol, midiNotes) {
  const want = expectedChordChroma(symbol);
  const got = new Set(midiNotes.map(midiToChroma));
  const correct = want.size === got.size && [...want].every((c) => got.has(c));
  return {
    correct,
    expected: [...want],
    played: [...got],
    detected: detectChords(midiNotes),
  };
}

/**
 * Grade an interval: did the student play `intervalName` above `refMidi`?
 * @returns {{ correct, expectedSemitones, playedSemitones }}
 */
export function gradeInterval(refMidi, intervalName, playedMidi) {
  const expectedSemitones = Interval.semitones(intervalName);
  const playedSemitones = playedMidi - refMidi;
  return {
    correct: playedSemitones === expectedSemitones,
    expectedSemitones,
    playedSemitones,
  };
}

/** Pitch-class chromas for a named scale, e.g. "G major". */
export function scaleChromas(name) {
  return Scale.get(name).notes.map(Note.chroma);
}

/**
 * Grade one step of a scale drill: is `playedMidi` the chroma expected at
 * `index` (ascending, wrapping)?
 */
export function gradeScaleStep(name, index, playedMidi) {
  const chromas = scaleChromas(name);
  if (chromas.length === 0) return { correct: false, expected: null, index };
  const expected = chromas[index % chromas.length];
  return { correct: midiToChroma(playedMidi) === expected, expected, index };
}

/**
 * Expand a roman-numeral progression in a key into chord symbols, e.g.
 * progressionChords("C", ["ii","V","I"]) → ["Dm","G","C"].
 */
export function progressionChords(key, romanNumerals) {
  return Progression.fromRomanNumerals(key, romanNumerals);
}
