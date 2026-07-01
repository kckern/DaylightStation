// Harmonic signature — reduce a roman progression to a canonical, length-
// independent key so realizations of the same harmony over different bar counts
// compare equal. Pure, no DOM. Used by the loop matcher (gate stacking) and the
// scheduler (align on the harmonic cycle).

/** Collapse consecutive duplicate chords (rate/duration-independent). */
export function normalizeProgression(roman) {
  if (!Array.isArray(roman)) return [];
  const out = [];
  for (const c of roman) {
    if (!c) continue;
    if (out[out.length - 1] !== c) out.push(c);
  }
  return out;
}
