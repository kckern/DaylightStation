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

export default { rangeSteps, clampStepToRange, nextStepInRange, sectionToRange };
