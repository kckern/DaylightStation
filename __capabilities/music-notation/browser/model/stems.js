// Stem engraving rules shared by every staff surface (wet ink, ActionStaff).
// Positions are staff half-steps above the BOTTOM line (bottom line = 0, middle
// line = 4) — the convention of both model/pitch.js getStaffPosition and the
// Composer's staffPositionOf. Lengths are in lineSpacing units (spaces).

export const MIDDLE_LINE = 4; // position of the centre staff line — the stem-flip point

// STEMMING (standard engraving rules; positions are staff HALF-steps, so one
// space = 2 and one octave = 7).
export const STEM_LEN_UNITS = 3.5; // default stem length, in lineSpacing units (≈ one octave)
export const STEM_MIN_UNITS = 2.5; // never shorter than this (only beamed groups compress, and we don't beam)
const OCTAVE_HALF_STEPS = 7;       // "more than an octave from the middle line" → extend to the middle line

/**
 * Which way the stem points for a set of simultaneous noteheads.
 *
 * - ONE note: up when it sits BELOW the middle line, down at or above it. The
 *   middle-line note itself stems DOWN — that is the convention (Gould, Behind
 *   Bars; Ross), not an off-by-one.
 * - A GROUP (chord / same onset): every member shares ONE direction, decided by
 *   the notehead FARTHEST from the middle line (max |position − 4|), because
 *   that is the note whose stem would otherwise shoot off the system. Ties (a
 *   chord straddling the middle line symmetrically, e.g. positions 2 and 6) go
 *   DOWN, again per convention.
 *
 * @param {number[]|number} positions - staff positions of the simultaneity.
 * @returns {'up'|'down'}
 */
export function stemDirectionFor(positions) {
  const list = (Array.isArray(positions) ? positions : [positions]).filter((p) => Number.isFinite(p));
  if (!list.length) return 'down'; // degenerate; match the tie convention rather than throwing
  let bestDist = -1;
  let dir = 'down';
  for (const p of list) {
    const dist = Math.abs(p - MIDDLE_LINE);
    const own = p < MIDDLE_LINE ? 'up' : 'down';
    if (dist > bestDist) { bestDist = dist; dir = own; }
    // Equal distance = a straddling tie: 'down' wins whichever order we saw them in.
    else if (dist === bestDist && own === 'down') dir = 'down';
  }
  return dir;
}

/**
 * Stem length in lineSpacing units for ONE notehead.
 *
 * Default 3.5 spaces. A notehead more than an OCTAVE from the middle line gets a
 * stem long enough to REACH the middle line (standard rule — it visually ties a
 * far-ledgered note back to the staff, which is exactly the "way too long /
 * way too short, disagreeing with its neighbours" case the fixed 3.5 got wrong).
 *
 * Only extends when the stem actually points TOWARD the middle line: a group
 * direction can force an outlier to stem away from it (positions [-6, 12] → the
 * -6 is farthest, so the 12 stems up, away), and lengthening that would drive it
 * off the top of the system.
 */
export function stemLengthUnits(position, direction = 'up') {
  const dist = Math.abs(position - MIDDLE_LINE);
  const towardMiddle = direction === 'up' ? position < MIDDLE_LINE : position > MIDDLE_LINE;
  const len = dist > OCTAVE_HALF_STEPS && towardMiddle
    ? Math.max(STEM_LEN_UNITS, dist / 2) // dist is in half-steps; /2 → spaces
    : STEM_LEN_UNITS;
  return Math.max(STEM_MIN_UNITS, len);
}
