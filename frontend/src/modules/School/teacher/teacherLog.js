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
};

export default teacherLog;
