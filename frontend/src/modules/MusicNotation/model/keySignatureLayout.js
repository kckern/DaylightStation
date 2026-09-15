// MusicNotation model — where a key signature's glyphs sit, and what a
// notehead under one still has to carry beside it.
//
// `keySignature.js` knows WHICH pitch classes a key sharps or flats. This
// module knows the two things an engraver needs on top of that: the printed
// order and staff position of each glyph after the clef, and the rule for a
// notehead once the signature is standing — a sharp the signature already
// carries is not written again, a natural on an altered letter gets a natural
// sign, and everything else is left alone.
//
// Pure. Positions are the staff half-steps above the bottom line that
// `model/pitch.js` uses everywhere (treble bottom line E4 = 0, bass G2 = 0).

import { KEY_SIGNATURES } from './keySignature.js';

/** The printed order of sharps and of flats — the same on every clef. */
export const SHARP_ORDER = Object.freeze(['F', 'C', 'G', 'D', 'A', 'E', 'B']);
export const FLAT_ORDER = Object.freeze(['B', 'E', 'A', 'D', 'G', 'C', 'F']);

/**
 * Staff positions of each signature glyph, in printed order, per clef.
 * Treble sharps: F5 C5 G5 D5 A4 E5 B4. Treble flats: B4 E5 A4 D5 G4 C5 F4.
 * Bass sits a third lower — the same letters, two positions down.
 */
const SHARP_POSITIONS = Object.freeze({ treble: [8, 5, 9, 6, 3, 7, 4], bass: [6, 3, 7, 4, 1, 5, 2] });
const FLAT_POSITIONS = Object.freeze({ treble: [4, 7, 3, 6, 2, 5, 1], bass: [2, 5, 1, 4, 0, 3, 6] });

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** The letter on each clef's bottom line, as an index into LETTERS. */
const BOTTOM_LETTER = Object.freeze({ treble: 2, bass: 4 });

/** `'B♭'` → `'Bb'`, `'F♯'` → `'F#'`; anything else unchanged. */
function normalizeKey(key) {
  if (typeof key !== 'string') return null;
  const text = key.trim().replace('♭', 'b').replace('♯', '#');
  return text.length ? text : null;
}

/**
 * What a key signature is made of.
 *
 * @param {string|null} key A major key as `instanceKeySignature` names it —
 *   `'D'`, `'Bb'`, `'F#'`. C major, no key, and a key the table does not name
 *   all answer null: nothing is drawn, and every accidental stays beside its
 *   note, which is the picture this module existed without.
 * @returns {{ kind: 'sharp'|'flat', count: number, letters: string[] } | null}
 */
export function keySignatureSpec(key) {
  const name = normalizeKey(key);
  const entry = name ? KEY_SIGNATURES[name] : null;
  if (!entry) return null;
  if (entry.sharps.length) {
    return { kind: 'sharp', count: entry.sharps.length, letters: SHARP_ORDER.slice(0, entry.sharps.length) };
  }
  if (entry.flats.length) {
    return { kind: 'flat', count: entry.flats.length, letters: FLAT_ORDER.slice(0, entry.flats.length) };
  }
  return null;
}

/**
 * The glyphs to draw after the clef, in order.
 * @returns {Array<{ kind: 'sharp'|'flat', letter: string, position: number }>}
 */
export function keySignatureMarks(key, clef) {
  const spec = keySignatureSpec(key);
  if (!spec) return [];
  const table = (spec.kind === 'sharp' ? SHARP_POSITIONS : FLAT_POSITIONS)[clef === 'bass' ? 'bass' : 'treble'];
  return spec.letters.map((letter, index) => ({ kind: spec.kind, letter, position: table[index] }));
}

/** The letter a staff position names on a clef, ledger lines included. */
export function letterAtPosition(position, clef) {
  const base = BOTTOM_LETTER[clef === 'bass' ? 'bass' : 'treble'];
  return LETTERS[(((base + position) % 7) + 7) % 7];
}

/**
 * What to draw beside a notehead once the signature is standing.
 *
 * `head` is a spelled notehead as `getStaffPositionOnClef` returns it: a
 * `position`, and `isSharp`/`isFlat` for a black key. A sharp is spelled from
 * the natural below, so F♯ sits on F's position and the letter read off the
 * position IS the letter the signature would alter.
 *
 * @returns {'sharp'|'flat'|'natural'|null}
 */
export function inkForHead(head, key, clef) {
  const spec = keySignatureSpec(key);
  const own = head?.isSharp ? 'sharp' : head?.isFlat ? 'flat' : null;
  if (!spec) return own;
  const covered = spec.letters.includes(letterAtPosition(head?.position ?? 0, clef));
  if (own) return covered && spec.kind === own ? null : own;
  return covered ? 'natural' : null;
}
