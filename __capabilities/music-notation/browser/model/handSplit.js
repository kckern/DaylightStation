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
 * column is two hands and divides at the best split point (see below).
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

  // A wide column entirely on one side of middle C has no register evidence of a
  // second hand (a rolled left-hand twelfth C2+G3; a right-hand tenth+ roll), and
  // splitting it strands notes on the wrong clef. The replay gate counts a column
  // wholly at/above C4 that reaches the bass as a right-hand-on-bass fault (0 now,
  // 1933 when this was left to the search below), so it stays whole on its side.
  if (notes[notes.length - 1] < HAND_PIVOT) return { bassNotes: notes, trebleNotes: [] };
  if (notes[0] >= HAND_PIVOT) return { bassNotes: [], trebleNotes: notes };

  // Two hands: try every split point and pick the best, in one pass. The old
  // pivot split followed by two reach-correction loops let each loop undo the
  // other on real captures (an 18-semitone treble "hand", towers of ledger lines,
  // notes far across middle C). Ranking, in order: both hands within reach;
  // fewest notes on the wrong side of middle C; least reach overflow; widest gap.
  // A three-hand cluster has no playable split; the same ranking picks the least bad.
  let best = null;
  for (let k = 1; k < notes.length; k++) {
    const bassSpan = notes[k - 1] - notes[0];
    const trebleSpan = notes[notes.length - 1] - notes[k];
    let wrong = 0;
    for (let i = 0; i < k; i++) if (notes[i] >= HAND_PIVOT) wrong++;
    for (let i = k; i < notes.length; i++) if (notes[i] < HAND_PIVOT) wrong++;
    const cand = {
      k,
      unplayable: bassSpan > HAND_SPAN || trebleSpan > HAND_SPAN ? 1 : 0,
      wrong,
      overflow: Math.max(bassSpan, trebleSpan) - HAND_SPAN,
      gap: notes[k] - notes[k - 1],
    };
    if (!best
      || cand.unplayable < best.unplayable
      || (cand.unplayable === best.unplayable && (cand.wrong < best.wrong
        || (cand.wrong === best.wrong && (cand.overflow < best.overflow
          || (cand.overflow === best.overflow && cand.gap > best.gap)))))) {
      best = cand;
    }
  }
  return { bassNotes: notes.slice(0, best.k), trebleNotes: notes.slice(best.k) };
};
