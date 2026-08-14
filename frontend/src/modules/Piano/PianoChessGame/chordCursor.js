import { identifyChord } from './chordAddress.js';
import { isStaffScheme } from './staffAddress.js';

/**
 * Turning hands into squares.
 *
 * A chord is not an event, it is a shape held over time: the notes of one chord
 * land tens of milliseconds apart, so reading the keyboard the instant a key goes
 * down would see a single note, then an interval, then the chord. This module
 * waits for the held set to stop changing, then previews it.
 *
 * Commit happens on release rather than on recognition. The fullest/latest
 * growing shape is retained through a staggered release, so a major triad played
 * on the way to a major seventh can never fire the triad's square prematurely.
 * Preview is only feedback; release is the sole statement of intent.
 */

export const DEFAULT_SETTLE_MS = 140;

/** Chords need three notes; two is an interval and one is a note. */
export const MIN_CHORD_NOTES = 3;

/**
 * How many notes it takes to name a square, which depends on the vocabulary:
 * a chord needs three, a staff address is exactly two — one note on each staff.
 */
export const minNotesFor = (scheme) => (isStaffScheme(scheme) ? 2 : MIN_CHORD_NOTES);

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
  return { held: [], intentNotes: [], stableSince: null, preview: null };
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
  const minNotes = minNotesFor(scheme);

  // Release: everything is up, so resolve the complete shape the player built,
  // not whichever smaller shape happened to sit still long enough for a preview.
  // Settling is a visual debounce, not a condition the fingers have to satisfy.
  if (!held.length) {
    const intentNotes = state.intentNotes?.length ? state.intentNotes : state.held;
    const addressed = intentNotes.length >= minNotes ? identifyChord(intentNotes, scheme) : null;
    if (isOctave(intentNotes) && !addressed?.square) {
      return { state: createCursorState(), event: { type: 'escape' } };
    }
    if (intentNotes.length >= minNotes) {
      return {
        state: createCursorState(),
        event: {
          type: 'commit',
          square: addressed?.square ?? null,
          chord: addressed?.square ? addressed : null,
        },
      };
    }
    return { state: createCursorState(), event: null };
  }

  // A same-size revision or an addition is new intent. A reduction is normally
  // fingers lifting at different times, so it must not replace the complete
  // shape that will be resolved when the last key comes up. A corrected note's
  // replacement onset grows the live set again and becomes the new intent.
  if (!sameNotes(held, state.held)) {
    const intentNotes = held.length >= state.held.length ? held : state.intentNotes;
    return { state: { ...state, held, intentNotes, stableSince: now, preview: null }, event: null };
  }

  const stableSince = state.stableSince ?? now;
  if (now - stableSince < settleMs) return { state: { ...state, held, stableSince }, event: null };

  // Do not let the tail of a staggered release preview a different, smaller
  // chord. It is release residue, not a fresh fingering.
  if (held.length < state.intentNotes.length) {
    return { state: { ...state, held, stableSince }, event: null };
  }

  // Checked before the note-count gate: an octave is two notes, so the chord
  // minimum would otherwise swallow it.
  //
  // An escape only arms from a clean read. A doubled-root voicing released
  // finger by finger leaves the root octave sounding — so without this guard,
  // the most ordinary way a child plays and releases C major would overwrite the
  // chord just recognised and cancel their move instead of playing it.
  // An address is checked first, because in the reading vocabulary a square can
  // BE an octave: the bass and treble staves both carry a C, so C2-with-C4 is a
  // legitimate square. The escape stays reachable because it is played within
  // one hand — two notes on the same staff, which is never an address.
  const addressed = held.length >= minNotes ? identifyChord(held, scheme) : null;

  if (isOctave(held) && !addressed?.square) {
    if (state.preview) return { state: { ...state, held, stableSince }, event: null };
    const preview = { escape: true, square: null };
    return { state: { ...state, held, stableSince, preview }, event: { type: 'preview', square: null, chord: preview } };
  }

  if (!addressed) return { state: { ...state, held, stableSince }, event: null };

  const match = addressed;
  if (state.preview?.square === match.square && state.preview?.square) {
    return { state: { ...state, held, stableSince }, event: null };
  }
  const preview = { square: match.square, candidates: match.candidates, pitch_classes: match.pitch_classes };
  return { state: { ...state, held, stableSince, preview }, event: { type: 'preview', square: match.square, chord: preview } };
}
