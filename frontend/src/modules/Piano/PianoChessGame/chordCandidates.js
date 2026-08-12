import { chordBoard } from './chordAddress.js';

/**
 * Which squares are still possible given what is held.
 *
 * A square is a candidate while its chord contains EVERY pitch class currently
 * down — held ⊆ chord. One note usually lights a scatter across several files
 * and ranks, because a note can be the root of one chord and the third of
 * another; the set contracts with each note added until one square is left.
 *
 * Subset, not equality, is the whole point: equality only ever answers at the
 * end, and the player needs to see the board reacting on the way there.
 *
 * Among all candidates, keep only the most specific (smallest pitch class count).
 * This prevents supersets from dimming the board as the user plays toward a full chord.
 */
export function candidateSquares(heldNotes, scheme) {
  const held = [...new Set((heldNotes || [])
    .filter(Number.isFinite)
    .map((note) => ((note % 12) + 12) % 12))];
  if (held.length === 0) return [];
  const board = chordBoard(scheme);

  const candidates = Object.entries(board)
    .filter(([, chord]) => {
      const classes = chord?.pitch_classes;
      return Array.isArray(classes) && held.every((pc) => classes.includes(pc));
    })
    .map(([square, chord]) => ({ square, classes: chord.pitch_classes }));

  if (candidates.length === 0) return [];

  // Keep only the candidates with the smallest pitch class count (most specific)
  const minSize = Math.min(...candidates.map((c) => c.classes.length));
  return candidates
    .filter((c) => c.classes.length === minSize)
    .map((c) => c.square)
    .sort();
}

export default { candidateSquares };
