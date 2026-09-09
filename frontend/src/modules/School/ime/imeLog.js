/**
 * In-page IME logging facade — same pattern as schoolLog.js. Never use raw
 * console.* for diagnostics.
 */
import getLogger from '../../../lib/logging/Logger.js';

function logger() {
  return getLogger().child({ component: 'school-ime' });
}

function emit(category, detail, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  payload.detail = detail;
  logger()[level](`school.ime.${category}.${detail}`, payload);
}

export const imeLog = {
  mode: (detail, data) => emit('mode', detail, data),          // toggled | declared | released
  compose: (detail, data) => emit('compose', detail, data, 'debug'), // run-start | run-end
};

export default imeLog;
