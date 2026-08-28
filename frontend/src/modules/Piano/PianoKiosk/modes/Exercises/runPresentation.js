/**
 * runPresentation — what a rung makes the exercise run LOOK like.
 *
 * Pure: no React, no fetching, no logging, no throwing. Everything here answers
 * a presentation question the run must not answer inline, and every one of them
 * is reused by the hosts that mount the run (a gate knows its level's tier and
 * its material's key long before the run does).
 *
 * **Compatibility shim (ask-platform SP1, task 2).** The theory/geometry
 * helpers that used to live here — `accidentalForKey`, `instanceKeySignature`,
 * `clefForAsk`, `clefForInstance`, `sequenceStaffCanDraw` — moved verbatim to
 * `../../../ask/stagecraft.js`, which now owns them, and are re-exported
 * below unchanged so every existing import of this module keeps working.
 *
 * **Thin shim, cont'd (task 5b).** Stage selection itself moved out too:
 * `ExerciseRun` used to call `stageForTier(runTier, instance)`, a TIER-numbered
 * mirror of `../../../ask/askSchema.js`'s tuple-driven `deriveStage`, kept here
 * only because `deriveStage` had no consumer yet. It now has one — `ExerciseRun`
 * builds a tuple with `askSchema.js`'s `askTupleFor({ tier: runTier }, null)`
 * and calls `deriveStage(tuple, instance)` directly — so `stageForTier` had no
 * remaining caller and is deleted, along with the tests that pinned it
 * (`askSchema.test.js`'s 16-cell `deriveStage` table already proves the two
 * agreed on every cell). `deriveRunTier` stays: `ExerciseRun` still calls it,
 * not for stage routing but to fill in a `tier` NUMBER for hosts that name
 * none — needed for `data-tier`/`is-tier-N`, which `Exercises.scss` keys real
 * layout off. `staffFitsAsk` and `eventsToStaffNotes` are also unmoved,
 * unrelated `ExerciseRun`/`ExerciseNotation` concerns rather than schema-level
 * theory.
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
