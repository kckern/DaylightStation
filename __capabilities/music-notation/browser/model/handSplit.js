// MusicNotation model — hand inference & ottava transposition.
//
// Extracted verbatim (behavior-preserving) from
// __app_modules/Piano/components/CurrentChordStaff.jsx.

/**
 * Determine ottava (8va/8vb/15ma/15mb) needed to keep notes near the staff.
 *
 * @param {number[]} notes - MIDI notes assigned to this staff
 * @param {boolean} isHighRange - true for treble (check highest), false for bass (lowest)
 * @returns {{ octaves: number, marker: string }} octaves to shift for display
 */
export const getOttavaInfo = (notes, isHighRange) => {
  if (notes.length === 0) return { octaves: 0, marker: '' };

  if (isHighRange) {
    const highest = Math.max(...notes);
    if (highest > 105) return { octaves: 2, marker: '15ma' };
    if (highest > 93) return { octaves: 1, marker: '8va' };
    return { octaves: 0, marker: '' };
  } else {
    const lowest = Math.min(...notes);
    if (lowest < 28) return { octaves: 2, marker: '15mb' };
    if (lowest < 40) return { octaves: 1, marker: '8vb' };
    return { octaves: 0, marker: '' };
  }
};

/** Widest column one hand can plausibly cover, in semitones (a tenth + a tone). */
export const HAND_SPAN = 14;
/** Middle C: where the grand staff changes clef, and so where two hands divide. */
export const HAND_PIVOT = 60;

/**
 * Infer which hand plays which notes, splitting a sorted-ascending note set into
 * bass (left hand) and treble (right hand) staves. Register first, not interval
 * pattern: a column that fits under one hand (span <= HAND_SPAN) is ONE hand and
 * goes whole to treble if its mean is at/above middle C, else to bass; a wider
 * column is two hands and divides at middle C.
 *
 * Why: the old "octave/fifth in the lowest two = left hand" rule read right-hand
 * octaves and fifths (C5-C6, E5+B5) as bass. In the recorded sessions that put
 * 234 right-hand columns (5.4%) on the bass staff.
 *
 * Known limit: a left-hand Alberti figure played in the C4 octave reads as treble;
 * telling it apart needs voice tracking across columns, which this pure
 * per-column function cannot do.
 *
 * @param {number[]} notes - MIDI notes, ascending
 * @returns {{ bassNotes: number[], trebleNotes: number[] }}
 */
export const splitByHand = (notes) => {
  if (notes.length === 0) return { bassNotes: [], trebleNotes: [] };

  const span = notes[notes.length - 1] - notes[0];
  if (span <= HAND_SPAN) {
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    return mean >= HAND_PIVOT
      ? { bassNotes: [], trebleNotes: notes }
      : { bassNotes: notes, trebleNotes: [] };
  }

  return {
    bassNotes: notes.filter((n) => n < HAND_PIVOT),
    trebleNotes: notes.filter((n) => n >= HAND_PIVOT),
  };
};
