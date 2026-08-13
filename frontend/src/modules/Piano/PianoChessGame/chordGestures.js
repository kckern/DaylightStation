import { isOctave } from './chordCursor.js';

/**
 * Hint gestures: asking for help in a shape the board can never mean.
 *
 * Every square is a chord, so a request for help has to be something a chord
 * can never be. A run of adjacent semitones is exactly that — no quality on
 * the board voices three or four consecutive pitch classes — which is the
 * same trick `isOctave` (in ./chordCursor.js) already uses for "take it
 * back." `validateChordScheme` in ./chordAddress.js keeps that property true
 * as the chord vocabulary changes, so this recogniser does not have to.
 */

/** How many adjacent semitones each request takes. */
export const GESTURE_SIZES = Object.freeze({ hint: 3, best: 4 });

/** Distinct pitch classes, ascending. */
function pitchClasses(notes) {
  return [...new Set((notes || [])
    .filter(Number.isFinite)
    .map((note) => ((note % 12) + 12) % 12))].sort((a, b) => a - b);
}

/** True when the classes form one unbroken run of semitones, wrap included. */
function isAdjacentRun(classes) {
  if (classes.length < 2) return false;
  for (let offset = 0; offset < 12; offset += 1) {
    const run = Array.from({ length: classes.length }, (_, i) => (offset + i) % 12).sort((a, b) => a - b);
    if (run.length === classes.length && run.every((pc, i) => pc === classes[i])) return true;
  }
  return false;
}

/**
 * Asking for help, in a shape the board can never mean.
 *
 * Squares are chords; a run of adjacent semitones is not one, which is what
 * makes it free vocabulary — the same reason the octave was chosen for
 * take-it-back. Two adjacent semitones are NOT a gesture: a major seventh
 * contains its root and seventh a semitone apart, so a two-note cluster is a
 * legitimate partial chord on the way to a square.
 */
export function recognizeGesture(heldNotes) {
  if (isOctave(heldNotes || [])) return null;
  const classes = pitchClasses(heldNotes);
  if (!isAdjacentRun(classes)) return null;
  if (classes.length === GESTURE_SIZES.hint) return 'hint';
  if (classes.length === GESTURE_SIZES.best) return 'best';
  return null;
}

export default { recognizeGesture, GESTURE_SIZES };
