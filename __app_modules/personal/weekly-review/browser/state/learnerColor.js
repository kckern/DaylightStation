// Crayon hue per child, stable for a review window: a learner's colour is set
// by their position among the window's sorted distinct learner ids.

export const LEARNER_HUES = ['#2f6fde', '#f28c28', '#3fa34d', '#c2367a', '#f2c230', '#1f9e9a'];

// `extra` adds learners known from elsewhere (the window's showcases), so a
// child who appears only there still gets a hue.
export function learnerIdsForDays(days, extra = []) {
  const ids = new Set();
  for (const e of extra || []) if (e?.learnerId) ids.add(e.learnerId);
  for (const day of days || []) {
    for (const w of day?.schoolAll || []) if (w?.learnerId) ids.add(w.learnerId);
  }
  return [...ids].sort();
}

export function colorForLearner(learnerId, learnerIds) {
  const ids = [...new Set(learnerIds || [])].sort();
  const pos = ids.indexOf(learnerId);
  if (pos < 0) return LEARNER_HUES[0];
  return LEARNER_HUES[pos % LEARNER_HUES.length];
}
