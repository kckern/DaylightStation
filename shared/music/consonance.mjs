// Union-consonance stacking guardrail. Pure, no DOM.
//
// The HARD gate for what the loop library offers as stackable: two loops may
// layer only if, on every aligned beat, the UNION of their sounding pitch
// classes still spells a nameable chord quality. One clashing bar disqualifies
// the pair (worst slot decides); `score` survives as a ranking signal for
// near-misses.
//
// KEY-CONFORMED ASSUMPTION (important): timelines carry ROOT-RELATIVE pitch
// classes (see harmonicTimeline.mjs), and the app transposes loops to a shared
// root BEFORE stacking. `stackable` therefore unions the root-relative sets
// directly — it never consults `timeline.root`. Feeding it two loops that have
// NOT been conformed to the same root produces meaningless results.
//
// THE ROTATION RULE: templates are written relative to their own chord root,
// but slot sets are relative to the LOOP root — a V triad rel-C is {2,7,11},
// which is no template subset "rooted at 0", yet re-rooted on G (rotation 7)
// it is exactly {0,4,7}. `slotConsonant` therefore accepts a set iff SOME
// rotation of it is a subset of SOME template: ∃r ∈ 0..11 such that
// {(pc − r) mod 12} ⊆ template.
//
// Known leniencies of subset semantics (deliberate, spec-mandated): a bare
// tritone {0,6} passes as a dim shell ({0,6} ⊆ {0,3,6}), and a bare semitone
// {0,1} passes as a maj7 shell (rotated by 1 → {0,11} ⊆ {0,4,7,11}). Sparse
// dyads are read as incomplete chords rather than clashes; the specificity
// grading upstream keeps such bare dyads rare in practice.

import { mod12 } from './transpose.mjs';

/**
 * Nameable chord-quality templates as root-relative pitch-class sets (sorted).
 * This is the module's full musical vocabulary — kept complete even though
 * matching only needs the maximal entries (see below) — because later features
 * (chord naming, expert-override UI) want the individual qualities.
 * @type {Readonly<Record<string, number[]>>}
 */
export const CHORD_TEMPLATES = Object.freeze({
  root: [0],
  power: [0, 7],
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  add9: [0, 2, 4, 7], // add9 major
  madd9: [0, 2, 3, 7], // add9 minor
  maj9: [0, 2, 4, 7, 11],
  dom9: [0, 2, 4, 7, 10],
  min9: [0, 2, 3, 7, 10],
});

/** Pitch-class set → 12-bit mask (bit n = pc n present). */
function toMask(pcs) {
  let mask = 0;
  for (const pc of pcs) mask |= 1 << mod12(pc);
  return mask;
}

/** Rotate a 12-bit mask up by r semitones (set ⊆ rotated template ⟺ set−r ⊆ template). */
function rotateMask(mask, r) {
  return ((mask << r) | (mask >>> (12 - r))) & 0xfff;
}

// OPTIMIZATION (behavior-preserving): under subset semantics, matching against
// a template covers all of its subsets, so only MAXIMAL templates (those not
// contained in another) need checking — maj9/dom9/min9/dim7/m7b5/aug/sus4.
// Derived programmatically so edits to CHORD_TEMPLATES can't drift out of sync.
const TEMPLATE_MASKS = Object.values(CHORD_TEMPLATES).map(toMask);
const MAXIMAL_MASKS = TEMPLATE_MASKS.filter(
  (m) => !TEMPLATE_MASKS.some((other) => other !== m && (m & other) === m),
);
// All 12 rotations of each maximal template, precomputed once.
const ROTATED_MAXIMAL_MASKS = MAXIMAL_MASKS.flatMap(
  (m) => Array.from({ length: 12 }, (_, r) => rotateMask(m, r)),
);

/**
 * Is this pitch-class set consonant — i.e. does it spell (a subset of) a
 * nameable chord quality on SOME root? Tests all 12 rotations against the
 * template table (see THE ROTATION RULE above). The empty set is consonant:
 * a silent slot clashes with nothing.
 * @param {Iterable<number>} pcs pitch classes (Set or array; normalized mod 12)
 * @returns {boolean}
 */
export function slotConsonant(pcs) {
  const mask = toMask(pcs);
  if (mask === 0) return true;
  return ROTATED_MAXIMAL_MASKS.some((t) => (mask & t) === mask);
}

/** Greatest common divisor (positive integers). */
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Can two loops stack? Phase-aligns both timelines by tiling their slot arrays
 * to the LCM of their lengths (4 vs 8 → 8; 4 vs 6 → 12), then requires the
 * per-slot UNION of pitch classes to pass `slotConsonant` on EVERY aligned
 * slot — one clashing bar disqualifies.
 *
 * Assumes both timelines are key-conformed (see module header): slot sets are
 * unioned directly, `root`/`specificity` are ignored.
 *
 * A zero-length timeline (empty `slots`) is trivially stackable — nothing
 * sounding clashes with nothing — and returns { ok: true, worstSlot: -1, score: 1 }.
 *
 * @param {{slots:number[][]}} timelineA harmonicTimeline.mjs shape
 * @param {{slots:number[][]}} timelineB harmonicTimeline.mjs shape
 * @returns {{ok:boolean, worstSlot:number, score:number}} `ok` = every aligned
 *   slot consonant; `worstSlot` = index (in the aligned/tiled frame) of the
 *   first dissonant slot, or -1; `score` = fraction of consonant slots (0..1),
 *   for ranking near-misses.
 */
export function stackable(timelineA, timelineB) {
  const a = timelineA?.slots ?? [];
  const b = timelineB?.slots ?? [];
  if (a.length === 0 || b.length === 0) return { ok: true, worstSlot: -1, score: 1 };

  const alignedLength = (a.length * b.length) / gcd(a.length, b.length);
  let worstSlot = -1;
  let consonantCount = 0;
  for (let i = 0; i < alignedLength; i += 1) {
    const union = [...a[i % a.length], ...b[i % b.length]];
    if (slotConsonant(union)) consonantCount += 1;
    else if (worstSlot === -1) worstSlot = i;
  }
  return { ok: worstSlot === -1, worstSlot, score: consonantCount / alignedLength };
}

export default { CHORD_TEMPLATES, slotConsonant, stackable };
