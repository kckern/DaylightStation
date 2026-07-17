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

/** Divisions of a plain (undotted, non-triplet) note type, or undefined if unknown. */
export function baseDivisions(type) {
  return PALETTE.find((p) => p.type === type)?.divs;
}

const TRIPLET_FACTOR = 2 / 3;

/**
 * Duration of a note/rest in divisions, honoring dots and triplet. Generic
 * duration math — lives here in the shared MusicNotation layer (not the Composer
 * mode) so the serializer can depend on it without an upward dependency.
 */
export function noteDivisions(note) {
  let d = baseDivisions(note.type);
  if (note.dots) for (let i = 0; i < note.dots; i++) d *= 1.5;
  if (note.triplet) d *= TRIPLET_FACTOR;
  return Math.round(d);
}

/**
 * Split a duration (in divisions) into the fewest notatable palette pieces,
 * largest-first. Caller ties consecutive pieces. Non-triplet only; input must
 * be a multiple of the 16th grid (6).
 * @param {number} divs
 * @returns {Array<{type:string, divs:number}>}
 */
export function decomposeDuration(divs) {
  if (!Number.isInteger(divs) || divs <= 0 || divs % 6 !== 0) {
    throw new Error(`decomposeDuration: ${divs} must be a positive multiple of 6`);
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

// Triplet note values (⅔ of the plain palette), for exact-match lookup.
const TRIPLET = [
  { type: 'quarter', divs: 16 }, { type: 'eighth', divs: 8 }, { type: '16th', divs: 4 },
];

/**
 * Express a single note's duration (divisions) as {type, dots, triplet?} if it
 * is exactly a palette value, a single-dotted palette value, or a triplet value.
 * Returns null when the duration needs a tie (use decomposeDuration instead).
 * Used by the P2 duration-palette UI (not yet wired in P1).
 */
export function durationToType(divs) {
  for (const b of PALETTE) {
    if (divs === b.divs) return { type: b.type, dots: 0 };
    if (divs === b.divs * 1.5) return { type: b.type, dots: 1 };
  }
  for (const t of TRIPLET) {
    if (divs === t.divs) return { type: t.type, dots: 0, triplet: true };
  }
  return null;
}
