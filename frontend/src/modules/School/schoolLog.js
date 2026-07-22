/**
 * School logging facade — categories over a child logger (pattern:
 * frontend/src/modules/Feed/Scroll/feedLog.js). Spec §9 event names.
 */
import getLogger from '../../lib/logging/Logger.js';

function logger() {
  return getLogger().child({ component: 'school' });
}

function emit(category, detail, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  payload.detail = detail;
  logger()[level](`school.${category}.${detail}`, payload);
}

export const schoolLog = {
  profile: (detail, data) => emit('profile', detail, data),           // claimed | lapsed
  session: (detail, data) => emit('session', detail, data),           // start | end
  answer:  (detail, data) => emit('answer', detail, data, 'debug'),   // graded
  answerError: (detail, data) => emit('answer', detail, data, 'error'), // record-failed
  bank:    (detail, data) => emit('bank', detail, data, 'warn'),
  nav:     (detail, data) => emit('nav', detail, data),               // section | home
  materials: (detail, data) => emit('materials', detail, data),       // catalog-failed
  materialsError: (detail, data) => emit('materials', detail, data, 'error'),
};

export default schoolLog;
