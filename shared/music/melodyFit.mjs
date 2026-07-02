// Melody-over-harmony fit scorer. Pure, no DOM.
//
// RANKING signal, not a gate (design §4): "emphasized melody degrees landing
// on the harmony's chord tones rank high". Task 5.1's LibraryBrowser uses this
// to ORDER melodic candidates over the current harmonic stack; nothing is
// excluded by a low score (`stackable` in consonance.mjs is the hard gate).
// Deliberately simple and deterministic — sophistication can come later once
// real usage shows where it falls short.
//
// KEY-CONFORMED ASSUMPTION (important): timelines carry ROOT-RELATIVE pitch
// classes (see harmonicTimeline.mjs), and the app transposes loops to a shared
// root BEFORE comparing. `melodyFit` therefore compares the root-relative sets
// directly — it never consults `timeline.root`. Feeding it two loops that have
// NOT been conformed to the same root produces meaningless results.
//
// SCORING MODEL — per aligned slot (LCM tiling via consonance.alignSlots, the
// same alignment `stackable` uses), each sounding melody pitch class earns:
//   1.0  chord tone      — pc present in the harmony slot's set
//   0.5  diatonic        — pc in the scale on the shared root (see below)
//   0.0  chromatic       — neither
// Final score = (sum of per-pc scores) / (total melody pc count), i.e. a
// PC-WEIGHTED mean, NOT a mean of slot means: a slot sounding 4 pcs counts 4×
// a slot sounding 1. That naturally weights busier slots, which is the
// "emphasized degrees" intent at this (beat-set) resolution.
//
// MAJOR/MINOR CHARACTER HEURISTIC (deliberately simple, documented over
// clever): take the UNION of the harmony timeline's pcs — if it contains pc 3
// and NOT pc 4, the diatonic scale is natural minor {0,2,3,5,7,8,10};
// otherwise (including an EMPTY union — all-silent harmony) it is major
// {0,2,4,5,7,9,11}. A union holding both 3 and 4 reads as major.
//
// EDGE SEMANTICS:
// - Empty MELODY slot → skipped entirely (contributes to neither numerator nor
//   denominator): silence neither fits nor clashes.
// - Empty HARMONY slot under a sounding melody slot → the chord-tone tier is
//   impossible; melody pcs are judged against the scale only (diatonic → 0.5,
//   chromatic → 0). A zero-length harmony timeline (`slots: []`) is treated
//   the same way — as one all-silent slot.
// - Melody with NO sounding pcs anywhere (all slots empty, or `slots: []`)
//   → 0.5: neutral, there is nothing to judge either way.
// - Malformed argument (non-object, or `slots` not an array) → TypeError.
//   Like `stackable`, reaching this scorer without a real timeline is a
//   pipeline bug that must be loud, not a soft neutral score.

import { mod12 } from './transpose.mjs';
import { alignSlots } from './consonance.mjs';

const MAJOR_SCALE = Object.freeze(new Set([0, 2, 4, 5, 7, 9, 11]));
const NATURAL_MINOR_SCALE = Object.freeze(new Set([0, 2, 3, 5, 7, 8, 10]));

/**
 * Score how well a melody sits over a harmony, 0..1 (see module header for
 * the full model). Both arguments are `harmonicTimeline.mjs` shapes and must
 * be key-conformed to the same root.
 *
 * @param {{slots:number[][]}} melodyTimeline
 * @param {{slots:number[][]}} harmonyTimeline
 * @returns {number} fit score in [0, 1]; 0.5 when the melody is silent
 * @throws {TypeError} when either argument lacks an array `slots`
 */
export function melodyFit(melodyTimeline, harmonyTimeline) {
  if (!Array.isArray(melodyTimeline?.slots)) {
    throw new TypeError('melodyFit: melodyTimeline is not a harmonic timeline (missing array `slots`)');
  }
  if (!Array.isArray(harmonyTimeline?.slots)) {
    throw new TypeError('melodyFit: harmonyTimeline is not a harmonic timeline (missing array `slots`)');
  }

  // Major/minor character from the harmony's union (see header heuristic).
  const union = new Set();
  for (const slot of harmonyTimeline.slots) {
    for (const pc of slot) union.add(mod12(pc));
  }
  const scale = union.has(3) && !union.has(4) ? NATURAL_MINOR_SCALE : MAJOR_SCALE;

  // A zero-length harmony can't tile; treat it as one all-silent slot so the
  // melody is still judged against the scale. Normalize each harmony slot to
  // a mod-12 Set ONCE, before tiling, so tiled repeats share the lookup.
  const harmonySlots = harmonyTimeline.slots.length > 0 ? harmonyTimeline.slots : [[]];
  const harmonySets = harmonySlots.map((slot) => new Set(slot.map(mod12)));

  let total = 0;
  let count = 0;
  for (const [melodySlot, harmonySet] of alignSlots(melodyTimeline.slots, harmonySets)) {
    if (melodySlot.length === 0) continue; // silent melody slot: skipped
    for (const raw of melodySlot) {
      const pc = mod12(raw);
      if (harmonySet.has(pc)) total += 1; // chord tone
      else if (scale.has(pc)) total += 0.5; // diatonic non-chord tone
      // chromatic → 0
      count += 1;
    }
  }

  if (count === 0) return 0.5; // silent melody: neutral, nothing to judge
  return total / count;
}

export default melodyFit;
