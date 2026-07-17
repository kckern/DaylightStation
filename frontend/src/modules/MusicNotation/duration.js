// duration.js — pure duration arithmetic for the composer core.
// Internal resolution: DIVISIONS per quarter. 24 makes 16ths/triplets/dots exact.
export const DIVISIONS = 24;

// Plain (non-triplet) note palette, largest first, in divisions.
const PALETTE = [
  { type: 'whole', divs: 96 },
  { type: 'half', divs: 48 },
  { type: 'quarter', divs: 24 },
  { type: 'eighth', divs: 12 },
  { type: '16th', divs: 6 },
];

/**
 * Split a duration (in divisions) into the fewest notatable palette pieces,
 * largest-first. Caller ties consecutive pieces. Non-triplet only; input must
 * be a multiple of the 16th grid (6).
 * @param {number} divs
 * @returns {Array<{type:string, divs:number}>}
 */
export function decomposeDuration(divs) {
  if (!Number.isInteger(divs) || divs <= 0 || divs % 6 !== 0) {
    throw new Error(`decomposeDuration: ${divs} is not on the 16th grid`);
  }
  const pieces = [];
  let rest = divs;
  for (const value of PALETTE) {
    while (rest >= value.divs) {
      pieces.push({ type: value.type, divs: value.divs });
      rest -= value.divs;
    }
  }
  return pieces;
}
