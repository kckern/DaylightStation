/**
 * readingLog — the living-room reading session's logging facade (pattern:
 * `frontend/src/modules/Feed/Scroll/feedLog.js`).
 *
 * Its own child component (`school-reading`) rather than a category on
 * `schoolLog`, because this code does not run where the rest of School runs:
 * it is the living-room TV, a different device with a different failure mode,
 * and the first question anyone asks about it in the log store is "what
 * happened at the TV" — `context.component:school-reading` is that question.
 *
 * The seven events the feature cannot be debugged without:
 *   session-open        a card opened a session and the screen knows whose
 *   book-selected       a book tap arrived and the countdown started
 *   pick-changed        a second book replaced the first, mid-countdown
 *   countdown-expired   the pick was committed; attribution frozen here
 *   playback-started    the story is actually rolling (NOT the same moment)
 *   playback-completed  the story finished and a read is about to be written
 *   record-failed       the story played and the evidence did NOT land
 *
 * That last one matters most: a read that played but was never recorded is the
 * one failure a child cannot see and a parent will not believe.
 */
import getLogger from '../../../lib/logging/Logger.js';

function logger() {
  return getLogger().child({ component: 'school-reading' });
}

function emit(category, detail, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  payload.detail = detail;
  logger()[level](`school.reading.${category}`, payload);
}

export const readingLog = {
  /** session-open | session-close | learner-swapped | idle */
  session: (detail, data) => emit('session', detail, data),
  /** book-selected | pick-changed | countdown-expired | book-refused */
  pick: (detail, data) => emit('pick', detail, data),
  /** playback-started | playback-completed | playback-abandoned */
  playback: (detail, data) => emit('playback', detail, data),
  /** summary-loaded | book-metadata */
  screen: (detail, data) => emit('screen', detail, data, 'debug'),
  /** summary-failed | playing-report-failed | cue-blocked */
  warn: (detail, data) => emit('warn', detail, data, 'warn'),
  /** record-failed — the story played and the evidence did not land */
  error: (detail, data) => emit('error', detail, data, 'error'),
};

export default readingLog;
