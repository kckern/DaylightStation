/**
 * Teacher console logging facade — same category-over-child-logger pattern as
 * schoolLog.js, its own component so the console's traffic is filterable
 * apart from the kids' app.
 */
import getLogger from '../../../lib/logging/Logger.js';

function logger() {
  return getLogger().child({ component: 'school-teacher' });
}

function emit(category, detail, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  payload.detail = detail;
  logger()[level](`teacher.${category}.${detail}`, payload);
}

export const teacherLog = {
  nav: (detail, data) => emit('nav', detail, data),                   // mounted | tab | learner
  claim: (detail, data) => emit('claim', detail, data),               // claimed | released | restored
  fetch: (detail, data) => emit('fetch', detail, data, 'warn'),       // fetch-failed | unavailable
  fetchError: (detail, data) => emit('fetch', detail, data, 'error'), // hard failure
  // Teacher-initiated state changes, so the console can answer WHAT was being
  // attempted and not merely that a request failed. Before this category,
  // mutations logged through `fetch` and a SUCCESSFUL write logged nothing at
  // all — the backend recorded the change, but nothing recorded the intent
  // behind it. Carries { learnerId, action, ... } wherever the caller knows
  // them; the pair reads as one story in a log filtered to teacher.write.*
  write: (detail, data) => emit('write', detail, data),                 // attempted | saved
  writeRefused: (detail, data) => emit('write', detail, data, 'warn'),  // refused | blocked | stash-dropped
  // A render-time copy map (e.g. `RosterStrip.jsx`'s `GROWN_UP_ACTION`,
  // `MUTED_EXCUSE_FALLBACK`) missed a value the data model actually produced
  // — the map has drifted from its source of truth (`learnerDay.js`'s
  // `NEEDS_GROWN_UP`, itself mirroring `agenda.mjs`'s excuse ladder). The UI
  // degrades to a labelized fallback rather than rendering nothing, but this
  // is the signal that the copy map needs a matching edit.
  copyGap: (detail, data) => emit('copy-gap', detail, data, 'warn'),
};

export default teacherLog;
