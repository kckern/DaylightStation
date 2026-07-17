/**
 * focusRange — pure math for the Learn/Polish practice range. A range is measures
 * [inMeasure, outMeasure] (measure INDICES into `measures[]`), resolved to a step
 * span [lo, hi]; the cursor loops within it (wraps at hi). Sections come as measure
 * NUMBERS and are mapped to indices.
 */

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

/**
 * Nudge one edge of a focus by ±delta measures, clamped to [0, measureCount-1]
 * and to in ≤ out. Any nudge yields a plain custom range (a section label would
 * no longer describe the measures). Returns the same object if nothing changed
 * (a React state no-op).
 */
export function nudgeRange(focus, edge, delta, measureCount) {
  if (!focus) return focus;
  let { inMeasure, outMeasure } = focus;
  if (edge === 'in') inMeasure = Math.min(outMeasure, Math.max(0, inMeasure + delta));
  else outMeasure = Math.min(measureCount - 1, Math.max(inMeasure, outMeasure + delta));
  if (inMeasure === focus.inMeasure && outMeasure === focus.outMeasure) return focus;
  return { kind: 'custom', inMeasure, outMeasure };
}

export default { rangeSteps, clampStepToRange, nextStepInRange, sectionToRange, homeStep, nudgeRange };
