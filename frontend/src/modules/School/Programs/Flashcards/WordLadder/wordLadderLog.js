/**
 * Word-ladder logging facade (pattern: Feed/Scroll/feedLog.js). Never raw
 * console.* — every event lands in the log store as `school.word-ladder.*`.
 */
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-word-ladder' });
  return _logger;
}
function emit(event, data, level = 'info') {
  logger()[level](`school.word-ladder.${event}`, typeof data === 'object' && data !== null ? { ...data } : {});
}

export const wordLadderLog = {
  mounted: (data) => emit('mounted', data),
  unmounted: (data) => emit('unmounted', data),
  planLoaded: (data) => emit('plan.loaded', data),                       // counts + folded
  planFailed: (data) => emit('plan.failed', data, 'error'),
  checkAnswered: (data) => emit('check.answered', data),
  cardMarked: (data) => emit('card.marked', data),
  recordingUploaded: (data) => emit('recording.uploaded', data),
  recordingFailed: (data) => emit('recording.failed', data, 'warn'),
  recordingRefused: (data) => emit('recording.refused', data),
  micUnavailable: (data) => emit('mic.unavailable', data, 'warn'),
  reviewStarted: (data) => emit('review.started', data),
  reviewViewed: (data) => emit('review.viewed', data, 'debug'),
  done: (data) => emit('day.done', data),
  audioBlocked: (data) => emit('audio.blocked', data, 'debug'),
  writeFailed: (data) => emit('write.failed', data, 'warn'),
  planRefetched: (data) => emit('plan.refetched', data),
  apiRejected: (data) => emit('api.rejected', data, 'warn'),
  apiFailed: (data) => emit('api.failed', data, 'error'),
};

export default wordLadderLog;
