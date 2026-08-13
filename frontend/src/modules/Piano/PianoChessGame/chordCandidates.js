import { chordBoard } from './chordAddress.js';
import { isStaffScheme, staffCandidateSquares } from './staffAddress.js';

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
 */
export function candidateSquares(heldNotes, scheme) {
  // In the reading vocabulary a note lights a whole rank or a whole file, and
  // the octave is meaningful — so the pitch-class subset rule below is simply
  // the wrong question to ask.
  if (isStaffScheme(scheme)) return staffCandidateSquares(heldNotes, scheme);
  const held = [...new Set((heldNotes || [])
    .filter(Number.isFinite)
    .map((note) => ((note % 12) + 12) % 12))];
  if (held.length === 0) return [];
  const board = chordBoard(scheme);
  return Object.entries(board)
    .filter(([, chord]) => {
      const classes = chord?.pitch_classes;
      return Array.isArray(classes) && held.every((pc) => classes.includes(pc));
    })
    .map(([square]) => square)
    .sort();
}

export default { candidateSquares };
