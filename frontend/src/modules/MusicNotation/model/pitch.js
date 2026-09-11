// MusicNotation model — pitch & staff-position math.
//
// Consolidates MIDI→diatonic / clef / staff-position logic that previously lived
// inline in modules/Piano/components/ActionStaff.jsx. Pure, transport- and
// renderer-agnostic so any notation renderer (SVG staff today, MusicXML/OSMD
// later) can share one spelling/position model.

// White-key pitch classes within an octave (C D E F G A B).
export const WHITE_KEYS = new Set([0, 2, 4, 5, 7, 9, 11]);

// Pitch class → diatonic step within the octave (C=0 … B=6). White keys only.
export const NOTE_TO_DIATONIC = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

export const isBlackKey = (midiNote) => !WHITE_KEYS.has(((midiNote % 12) + 12) % 12);

/**
 * Default spelling for each black key, with no key signature to lean on.
 *
 * These are the same five leans as `CHROMATIC_LEANS_SHARP` in model/spelling.js,
 * read with C as the tonic: C♯ and F♯ spell sharp, E♭, A♭ and B♭ spell flat.
 * That module is the authority on the convention and explains why each one
 * leans the way it does; this is the no-context reduction of it, kept as a flat
 * table because it is read once per notehead per render and must stay cheap.
 * `pitch.test.js` asserts the two never drift apart.
 */
export const DEFAULT_BLACK_KEY_SPELLING = Object.freeze({
  1: 'sharp',   // C♯
  3: 'flat',    // E♭
  6: 'sharp',   // F♯
  8: 'flat',    // A♭
  10: 'flat',   // B♭
});

/**
 * Choose how to spell a black key (sharp vs flat).
 *
 * DETERMINISTIC. This used to default to `Math.random() < 0.5`, and because the
 * spelling decides the staff POSITION downstream — sharps spell from the natural
 * below, flats from the natural above — the same MIDI note rendered a diatonic
 * step higher or lower from one frame to the next. On the piano-chess rim that
 * meant a card the child could not recognise twice, and one note of a dyad
 * coming out flat while its partner came out sharp. A notehead's height is not
 * a coin flip.
 *
 * Callers that know the key pass `accidental` explicitly; everything else gets
 * the house lean above.
 *
 * @param {number} midiNote
 * @param {'sharp'|'flat'} [accidental] - force a spelling.
 * @returns {{ isSharp: boolean, isFlat: boolean }}
 */
export function spellAccidental(midiNote, accidental) {
  if (!isBlackKey(midiNote)) return { isSharp: false, isFlat: false };
  const choice = accidental === 'sharp' || accidental === 'flat'
    ? accidental
    : DEFAULT_BLACK_KEY_SPELLING[((midiNote % 12) + 12) % 12];
  return { isSharp: choice === 'sharp', isFlat: choice === 'flat' };
}

/**
 * Map a MIDI note to its position on a grand staff.
 *
 * @param {number} midiNote
 * @param {'sharp'|'flat'} [accidental] - spelling override (see spellAccidental).
 * @returns {{ position: number, clef: 'treble'|'bass', isSharp: boolean, isFlat: boolean }}
 *   position = diatonic half-steps above the bottom staff line of its clef
 *   (treble bottom line = E4, bass bottom line = G2).
 */
export function getStaffPosition(midiNote, accidental) {
  const { isSharp, isFlat } = spellAccidental(midiNote, accidental);

  // Sharps spell from the natural below; flats from the natural above.
  const baseMidi = isSharp ? midiNote - 1 : isFlat ? midiNote + 1 : midiNote;
  const octave = Math.floor(baseMidi / 12) - 1;
  const noteInOctave = ((baseMidi % 12) + 12) % 12;
  const diatonic = NOTE_TO_DIATONIC[noteInOctave] ?? 0;

  // Absolute diatonic index (C4 = 28).
  const absDiatonic = octave * 7 + diatonic;

  const useTreble = absDiatonic >= 28; // C4 and above → treble
  const clef = useTreble ? 'treble' : 'bass';
  const bottomLineDiatonic = useTreble ? 30 /* E4 */ : 18 /* G2 */;
  const position = absDiatonic - bottomLineDiatonic;

  return { position, clef, isSharp, isFlat };
}

/**
 * Diatonic distance between the two clefs' bottom lines: treble's E4 (30) sits
 * twelve diatonic steps above bass's G2 (18). Reading a treble position on a
 * bass staff means adding this; the other way, subtracting it.
 */
export const CLEF_POSITION_OFFSET = 12;

/**
 * Staff position of a pitch on a CHOSEN clef.
 *
 * getStaffPosition picks a clef per pitch, which is right for a lone note on
 * its own staff and wrong for a sequence: every note of a run has to be
 * measured against the one clef the staff actually draws, or a middle C reads
 * as if it were sitting where a bass-clef middle C sits.
 *
 * @param {number} midiNote
 * @param {'treble'|'bass'} [clef] - omit to accept the pitch's own clef.
 * @param {'sharp'|'flat'} [accidental] - spelling override (see spellAccidental).
 * @returns {{ position: number, clef: 'treble'|'bass', isSharp: boolean, isFlat: boolean }}
 */
export function getStaffPositionOnClef(midiNote, clef, accidental) {
  const natural = getStaffPosition(midiNote, accidental);
  if (!clef || clef === natural.clef) return natural;
  const position = clef === 'bass'
    ? natural.position + CLEF_POSITION_OFFSET
    : natural.position - CLEF_POSITION_OFFSET;
  return { ...natural, position, clef };
}
