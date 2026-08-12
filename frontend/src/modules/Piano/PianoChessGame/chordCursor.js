import { identifyChord } from '@shared-gaming/chess/index.mjs';

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

export function createCursorState() {
  return { held: [], stableSince: null, preview: null, committed: null };
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
    if (state.preview) {
      return {
        state: { ...createCursorState(), committed: state.preview },
        event: { type: 'commit', square: state.preview.square, chord: state.preview },
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
  if (held.length < MIN_CHORD_NOTES) return { state: { ...state, held, stableSince }, event: null };

  const match = identifyChord(held, scheme);
  if (state.preview?.square === match.square && state.preview?.square) {
    return { state: { ...state, held, stableSince }, event: null };
  }
  const preview = { square: match.square, candidates: match.candidates, pitch_classes: match.pitch_classes };
  return { state: { ...state, held, stableSince, preview }, event: { type: 'preview', square: match.square, chord: preview } };
}
