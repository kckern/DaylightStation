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

/** Reduce a chord array to its smallest unit that tiles the whole array. */
export function minimalCycle(chords) {
  const n = chords.length;
  if (n < 2) return [...chords];
  for (let len = 1; len <= n / 2; len += 1) {
    if (n % len !== 0) continue;
    const unit = chords.slice(0, len);
    let tiles = true;
    for (let i = 0; i < n; i += 1) {
      if (chords[i] !== unit[i % len]) { tiles = false; break; }
    }
    if (tiles) return unit;
  }
  return [...chords];
}

/**
 * Canonical, length-independent key for a roman progression, or null if there is
 * no harmonic content. Same harmony at any rate/repetition → same string.
 */
export function signatureKey(roman) {
  const cycle = minimalCycle(normalizeProgression(roman));
  return cycle.length ? cycle.join('-') : null;
}

/**
 * Can `cand` be layered on `base`? True iff they share a harmonic signature, OR
 * the candidate has no harmony of its own (a bare melody conforms to any base).
 * Retained for legacy layerMatch ranking; the stacking GATE is now
 * consonance.stackable() (design §4b).
 */
export function areStackable(baseRoman, candRoman) {
  const b = signatureKey(baseRoman);
  const c = signatureKey(candRoman);
  if (c === null) return true; // melodic wildcard
  if (b === null) return true; // base has no harmony to clash with
  return b === c;
}

export default { normalizeProgression, minimalCycle, signatureKey, areStackable };
