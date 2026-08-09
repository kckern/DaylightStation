/**
 * focusRange — pure math for the Learn/Polish practice range. A range is measures
 * [inMeasure, outMeasure] (measure INDICES into `measures[]`), resolved to a step
 * span [lo, hi]; the cursor loops within it (wraps at hi). Sections come as measure
 * NUMBERS and are mapped to indices.
 */
import { expectedMidisAtStep } from './activeParts.js';

/** Step span [firstStep(in), lastStep(out)] for a measure range. Guards bounds. */
export function rangeSteps(measures, { inMeasure, outMeasure }) {
  const inM = measures[inMeasure];
  const outM = measures[outMeasure];
  if (!inM || !outM) return null;
  return [inM.firstStep, outM.lastStep];
}

/** Clamp a step index into [lo, hi]. */
export function clampStepToRange(step, [lo, hi]) {
  if (step < lo) return lo;
  if (step > hi) return hi;
  return step;
}

/** Next step, wrapping back to lo after hi. */
export function nextStepInRange(step, [lo, hi]) {
  return step >= hi ? lo : step + 1;
}

/**
 * Next step the player can actually answer: walks forward from `step` (wrapping
 * within `range`, else linear) past every step whose ACTIVE-hands note set is
 * empty. Such a step exists on the page — the other hand plays it — but the gate
 * expects nothing there, and `isStepSatisfied` never passes on an empty set, so
 * landing on one would wait on a key that is never coming. They are everywhere in
 * real piano writing: a tie held across the barline vacates one staff while the
 * other re-attacks, and any single-hand passage does the same.
 *
 * @returns {{next:number, wrapped:boolean}} where to go, and whether the walk
 *   crossed the range's out-point (a completed lap);
 *   `{complete:true}` — unranged and the piece has no playable step left;
 *   `{stuck:true}` — the range holds nothing these hands can play (stay put).
 */
export function nextPlayableStep(step, { steps, activeParts, range = null }) {
  const len = steps?.length || 0;
  if (!len) return { complete: true };
  let cur = step;
  let wrapped = false;
  for (let guard = 0; guard < len; guard++) {
    if (range) {
      if (cur >= range[1]) { cur = range[0]; wrapped = true; } else cur += 1;
    } else {
      if (cur >= len - 1) return { complete: true };
      cur += 1;
    }
    if (cur >= 0 && cur < len && expectedMidisAtStep(steps[cur], activeParts || {}).size > 0) {
      return { next: cur, wrapped };
    }
  }
  return { stuck: true };
}

/** Map a section (measure NUMBERS) to a { inMeasure, outMeasure } of measure INDICES. */
export function sectionToRange(section, measures) {
  const find = (number) => measures.find((m) => m.number === number)?.index;
  const inMeasure = find(section.startMeasure);
  const outMeasure = find(section.endMeasure);
  if (inMeasure == null || outMeasure == null) return null;
  return { inMeasure, outMeasure };
}

/** Where Restart/reset should land: the loop in-point when a range is active, else 0. */
export function homeStep(range) {
  return range ? range[0] : 0;
}

export default { rangeSteps, clampStepToRange, nextStepInRange, nextPlayableStep, sectionToRange, homeStep };
