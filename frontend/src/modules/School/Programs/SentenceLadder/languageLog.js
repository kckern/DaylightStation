/**
 * Language-study logging facade — categories over a child logger, same
 * pattern as schoolLog.js. Never use raw console.* for diagnostics.
 */
import getLogger from '../../../../lib/logging/Logger.js';

function logger() {
  return getLogger().child({ component: 'school-language' });
}

function emit(category, detail, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  payload.detail = detail;
  logger()[level](`school.language.${category}.${detail}`, payload);
}

export const languageLog = {
  program: (detail, data) => emit('program', detail, data),              // mounted | unmounted | day-loaded
  programError: (detail, data) => emit('program', detail, data, 'error'), // day-failed
  rung: (detail, data) => emit('rung', detail, data, 'debug'),           // enter | advance | complete
  attempt: (detail, data) => emit('attempt', detail, data, 'debug'),     // saved
  attemptError: (detail, data) => emit('attempt', detail, data, 'error'), // record-failed
  audio: (detail, data) => emit('audio', detail, data, 'debug'),         // play | ended | preload
  audioError: (detail, data) => emit('audio', detail, data, 'warn'),     // play-blocked | load-failed
  capture: (detail, data) => emit('capture', detail, data),              // start | stop | saved
  captureError: (detail, data) => emit('capture', detail, data, 'error'), // denied | failed
  pacing: (detail, data) => emit('pacing', detail, data),                // changed | rolled
  capability: (detail, data) => emit('capability', detail, data),        // detected | overridden
};

export default languageLog;
