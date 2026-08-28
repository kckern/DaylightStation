/**
 * runPresentation — what a rung makes the exercise run LOOK like.
 *
 * Pure: no React, no fetching, no logging, no throwing. Everything here answers
 * a presentation question the run must not answer inline, and every one of them
 * is reused by the hosts that mount the run (a gate knows its level's tier and
 * its material's key long before the run does).
 *
 * Nothing in this module grades anything. `deriveRunTier` decides what is
 * DRAWN; the requirement decides what is judged, and the two are independent.
 *
 * **Compatibility shim (ask-platform SP1, task 2).** The theory/geometry
 * helpers that used to live here — `accidentalForKey`, `instanceKeySignature`,
 * `clefForAsk`, `clefForInstance`, `sequenceStaffCanDraw` — moved verbatim to
 * `../../../ask/stagecraft.js`, which now owns them, and are re-exported
 * below unchanged so every existing import of this module keeps working. New
 * tuple-driven stage resolution (`deriveStage`) lives in
 * `../../../ask/askSchema.js`; `deriveRunTier` and `stageForTier` — the
 * TIER-based routing only `ExerciseRun` still calls — stay here, along with
 * `staffFitsAsk` and `eventsToStaffNotes`, which are `ExerciseRun`-only
 * concerns rather than schema-level theory.
 */

import {
  accidentalForKey,
  askMidis,
  clefForAsk,
  clefForInstance,
  instanceKeySignature,
  MAX_ASK_SPAN,
  sequenceStaffCanDraw,
} from '../../../ask/stagecraft.js';

export { accidentalForKey, instanceKeySignature, clefForAsk, clefForInstance, sequenceStaffCanDraw };

/**
 * Is this ask small enough to reinforce with a staff? Two conditions, both
 * needed: it spans no more than an octave, and one clef holds all of it. An ask
 * that fails either is still a complete ask on lit keys — the staff is what
 * degrades, not the task.
 */
export function staffFitsAsk(events) {
  const midis = askMidis(events);
  if (!midis.length) return false;
  if (Math.max(...midis) - Math.min(...midis) > MAX_ASK_SPAN) return false;
  return clefForAsk(events) !== null;
}

/** One entry per event; an event carrying several notes becomes a chord column. */
export function eventsToStaffNotes(events) {
  return (events ?? []).map((event) => {
    const midis = (event?.notes ?? []).map((note) => note?.midi).filter((midi) => Number.isFinite(midi));
    return midis.length > 1 ? { midis } : { midi: midis[0] };
  });
}

/**
 * The tier a caller that named none is owed.
 *
 * `ordering: 'any'` material — a chord, an interval, anything whose own
 * contract is "in any order" — is a lit-keys ask at every tier: there is no
 * ordered notation for an unordered ask, and drawing one on a grand staff was
 * the thing this redesign is replacing. Everything else reads its tier off the
 * requirement: a cued ask is tier 3 (it is being judged against a beat, which
 * needs written rhythm), anything else is tier 2.
 */
export function deriveRunTier(instance, mode) {
  if (instance?.ordering === 'any') return 1;
  return mode === 'cued' ? 3 : 2;
}

/**
 * Which stage a tier mounts. `ordering: 'any'` overrides the tier for the
 * reason above — including a tier a host named explicitly, because the
 * alternative is a stage that cannot draw the material it was given.
 *
 * Tier 2's sequence staff is subject to the same rule, and for the same reason:
 * material one staff cannot hold falls back to the ABC path, which engraves a
 * grand staff. The gate's own shipped material — single-hand scales and lit
 * keys — is one-handed and inside an octave, so none of it moves.
 */
export function stageForTier(tier, instance) {
  if (instance?.ordering === 'any' || tier <= 1) return 'keys';
  if (tier === 2) return sequenceStaffCanDraw(instance) ? 'sequence' : 'notation';
  return 'notation';
}
