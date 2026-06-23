// MusicNotation model — hand inference & ottava transposition.
//
// Extracted verbatim (behavior-preserving) from
// modules/Piano/components/CurrentChordStaff.jsx.

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

/**
 * Infer which hand plays which notes, splitting a sorted-ascending note set into
 * bass (left hand) and treble (right hand) staves.
 *
 * @param {number[]} notes - MIDI notes, ascending
 * @returns {{ bassNotes: number[], trebleNotes: number[] }}
 */
export const splitByHand = (notes) => {
  if (notes.length === 0) return { bassNotes: [], trebleNotes: [] };

  // Single note: simple split at C4.
  if (notes.length === 1) {
    return notes[0] >= 60
      ? { bassNotes: [], trebleNotes: notes }
      : { bassNotes: notes, trebleNotes: [] };
  }

  // Two notes: octave/fifth = bass pattern, both go to bass.
  if (notes.length === 2) {
    const interval = notes[1] - notes[0];
    if (interval === 12 || interval === 7) {
      return { bassNotes: notes, trebleNotes: [] };
    }
    if (notes[0] >= 60) return { bassNotes: [], trebleNotes: notes };
    if (notes[1] < 60) return { bassNotes: notes, trebleNotes: [] };
    return { bassNotes: [notes[0]], trebleNotes: [notes[1]] };
  }

  // 3+ notes: bass pattern (octave/fifth) in the lowest two → left hand.
  const lowest = notes[0];
  const secondLowest = notes[1];
  const interval = secondLowest - lowest;
  if (interval === 12 || interval === 7) {
    return { bassNotes: [lowest, secondLowest], trebleNotes: notes.slice(2) };
  }

  // Otherwise split at the largest gap if it's significant.
  let maxGap = 0;
  let maxGapIndex = 0;
  for (let i = 0; i < notes.length - 1; i++) {
    const gap = notes[i + 1] - notes[i];
    if (gap > maxGap) {
      maxGap = gap;
      maxGapIndex = i;
    }
  }
  if (maxGap > 4) {
    return {
      bassNotes: notes.slice(0, maxGapIndex + 1),
      trebleNotes: notes.slice(maxGapIndex + 1),
    };
  }

  // No clear split: all to one staff based on average.
  const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
  return avg >= 60
    ? { bassNotes: [], trebleNotes: notes }
    : { bassNotes: notes, trebleNotes: [] };
};
