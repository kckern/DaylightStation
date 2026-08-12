import { identifyChord } from './chordAddress.js';

/**
 * Turning hands into squares.
 *
 * A chord is not an event, it is a shape held over time: the notes of one chord
 * land tens of milliseconds apart, so reading the keyboard the instant a key goes
 * down would see a single note, then an interval, then the chord. This module
 * waits for the held set to stop changing, then reads it.
 *
 * Commit happens on release rather than on recognition. That gives the player a
 * preview they can correct while still holding — a cursor, not a trigger — and it
 * makes playing the same chord twice in a row work, which a move like Nf3-g1-f3
 * needs.
 */

export const DEFAULT_SETTLE_MS = 140;

/** Chords need three notes; two is an interval and one is a note. */
export const MIN_CHORD_NOTES = 3;

/**
 * The take-it-back gesture: any note and the same note an octave away.
 *
 * An octave can never be mistaken for a chord — it is one pitch class, and every
 * square on the board is three or four — so it is free to mean "cancel" without
 * shadowing a square. It is also the one shape a player can find without
 * reading anything, which is what an escape has to be.
 */
export function isOctave(notes) {
  if (notes.length < 2) return false;
  const pitchClasses = new Set(notes.map((note) => ((note % 12) + 12) % 12));
  return pitchClasses.size === 1 && Math.max(...notes) - Math.min(...notes) >= 12;
}

export function createCursorState() {
  return { held: [], stableSince: null, preview: null };
}

const sameNotes = (a, b) => a.length === b.length && a.every((note, index) => note === b[index]);

/**
 * Advances the cursor one tick.
 *
 * @param {object} state previous cursor state
 * @param {number[]} notes MIDI notes currently held
 * @param {number} now monotonic-ish timestamp in ms
 * @param {object} options settleMs and the chord scheme
 * @returns {{state: object, event: null | {type: 'preview'|'commit', square: string|null, chord: object}}}
 */
export function advanceCursor(state, notes, now, { settleMs = DEFAULT_SETTLE_MS, scheme = undefined } = {}) {
  const held = [...notes].sort((a, b) => a - b);

  // Release: everything is up, so whatever was previewed is the player's answer.
  if (!held.length) {
    // A chord tapped and let go inside the settle window was never read. Saying
    // so beats the silence a child cannot tell apart from a broken piano.
    if (!state.preview && state.held.length >= MIN_CHORD_NOTES) {
      return { state: createCursorState(), event: { type: 'too_quick' } };
    }
    if (state.preview) {
      return {
        state: createCursorState(),
        event: state.preview.escape
          ? { type: 'escape' }
          : { type: 'commit', square: state.preview.square, chord: state.preview },
      };
    }
    return { state: createCursorState(), event: null };
  }

  // The shape is still changing; restart the settle clock and show nothing yet.
  if (!sameNotes(held, state.held)) {
    return { state: { ...state, held, stableSince: now }, event: null };
  }

  const stableSince = state.stableSince ?? now;
  if (now - stableSince < settleMs) return { state: { ...state, held, stableSince }, event: null };

  // Checked before the note-count gate: an octave is two notes, so the chord
  // minimum would otherwise swallow it.
  //
  // An escape only arms from a clean read. A doubled-root voicing released
  // finger by finger leaves the root octave sounding — so without this guard,
  // the most ordinary way a child plays and releases C major would overwrite the
  // chord just recognised and cancel their move instead of playing it.
  if (isOctave(held)) {
    if (state.preview) return { state: { ...state, held, stableSince }, event: null };
    const preview = { escape: true, square: null };
    return { state: { ...state, held, stableSince, preview }, event: { type: 'preview', square: null, chord: preview } };
  }

  if (held.length < MIN_CHORD_NOTES) return { state: { ...state, held, stableSince }, event: null };

  const match = identifyChord(held, scheme);
  if (state.preview?.square === match.square && state.preview?.square) {
    return { state: { ...state, held, stableSince }, event: null };
  }
  const preview = { square: match.square, candidates: match.candidates, pitch_classes: match.pitch_classes };
  return { state: { ...state, held, stableSince, preview }, event: { type: 'preview', square: match.square, chord: preview } };
}
