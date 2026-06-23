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
 * Choose how to spell a black key (sharp vs flat).
 *
 * @param {number} midiNote
 * @param {'sharp'|'flat'} [accidental] - force a spelling; omit for the legacy
 *   random 50/50 choice (preserves ActionStaff's original behavior).
 * @returns {{ isSharp: boolean, isFlat: boolean }}
 */
export function spellAccidental(midiNote, accidental) {
  if (!isBlackKey(midiNote)) return { isSharp: false, isFlat: false };
  if (accidental === 'sharp') return { isSharp: true, isFlat: false };
  if (accidental === 'flat') return { isSharp: false, isFlat: true };
  // Legacy default: random sharp/flat (caller is expected to memoize per render).
  const isSharp = Math.random() < 0.5;
  return { isSharp, isFlat: !isSharp };
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
