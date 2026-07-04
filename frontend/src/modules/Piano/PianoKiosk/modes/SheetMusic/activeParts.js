/**
 * activeParts — the single "which staves am I responsible for" model shared by
 * Follow tracking, note light-up, and the keyboard target set. Staves are 0-indexed
 * (0 = top = RH, 1 = LH, …). "Active" = you must play it / it lights as a target.
 */
export function staffLabels(staves) {
  return staves.map((s) => (s === 0 ? 'RH' : s === 1 ? 'LH' : `P${s + 1}`));
}

/** Every staff present in `notes`, all switched on (full-hand default). */
export function defaultActiveParts(notes) {
  const out = {};
  for (const n of notes || []) out[n.staff] = true;
  return out;
}

/** Midis expected at a step, filtered to the active staves. */
export function expectedMidisAtStep(step, active) {
  const set = new Set();
  for (const n of step?.notes || []) if (active[n.staff]) set.add(n.midi);
  return set;
}

/** All-notes rule: every expected midi must be present in the struck set. */
export function isStepSatisfied(expected, struck) {
  for (const m of expected) if (!struck.has(m)) return false;
  return expected.size > 0;
}

export default { staffLabels, defaultActiveParts, expectedMidisAtStep, isStepSatisfied };
