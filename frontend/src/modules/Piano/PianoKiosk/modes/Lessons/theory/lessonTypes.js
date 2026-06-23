// Theory lesson catalog — the four tonal-backed interactive lesson types.
//
// SKELETON: each entry declares its identity + which engine primitive grades it.
// The actual lesson-runner components are not built yet (status: 'skeleton').

import {
  gradeChord,
  gradeInterval,
  gradeScaleStep,
  progressionChords,
} from './theoryEngine.js';

export const LESSON_TYPES = [
  {
    id: 'chord-id',
    label: 'Chord ID / Build-a-Chord',
    blurb: 'Show a target chord; hold it on the keys for an instant grade — or name what you play.',
    grade: gradeChord, // (symbol, midiNotes) → verdict
    status: 'skeleton',
  },
  {
    id: 'interval-trainer',
    label: 'Interval Trainer',
    blurb: 'Play the requested interval above a lit note. Graded by semitone distance.',
    grade: gradeInterval, // (refMidi, intervalName, playedMidi) → verdict
    status: 'skeleton',
  },
  {
    id: 'scale-drills',
    label: 'Scale Drills',
    blurb: 'Play a named scale ascending/descending in order; graded note-by-note.',
    grade: gradeScaleStep, // (name, index, playedMidi) → verdict
    status: 'skeleton',
  },
  {
    id: 'chord-progressions',
    label: 'Chord Progressions',
    blurb: 'Play a roman-numeral progression (e.g. ii–V–I) chord by chord.',
    expand: progressionChords, // (key, romanNumerals) → chord symbols
    grade: gradeChord, // each step graded as a chord
    status: 'skeleton',
  },
];

export const getLessonType = (id) => LESSON_TYPES.find((t) => t.id === id) ?? null;
