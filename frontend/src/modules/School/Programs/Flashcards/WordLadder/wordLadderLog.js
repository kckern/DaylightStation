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
  started: (data) => emit('started', data),                              // Start tapped
  planLoaded: (data) => emit('plan.loaded', data),                       // sitting opened
  planFailed: (data) => emit('plan.failed', data, 'error'),
  audioBlocked: (data) => emit('audio.blocked', data, 'info'),
  writeFailed: (data) => emit('write.failed', data, 'warn'),
  sessionReopened: (data) => emit('session.reopened', data),
  apiRejected: (data) => emit('api.rejected', data, 'warn'),
  apiFailed: (data) => emit('api.failed', data, 'error'),
  layoutClamped: (data) => emit('layout.clamped', data, 'warn'),
  mediaFailed: (data) => emit('media.failed', data, 'warn'),        // image cue → text fallback
  stageFailed: (data) => emit('stage.failed', data, 'warn'),
  itemShown: (data) => emit('item.shown', data),
  itemAnswered: (data) => emit('item.answered', data),
  sittingLeft: (data) => emit('sitting.left', data),
  audioPlayed: (data) => emit('audio.played', data),
  keypadToggled: (data) => emit('keypad.toggled', data),   // {auto, open}
  recordingUploaded: (data) => emit('recording.uploaded', data),
  recordingFailed: (data) => emit('recording.failed', data, 'warn'),
  recordingRefused: (data) => emit('recording.refused', data, 'info'),
  matchCompleted: (data) => emit('match.completed', data),               // {ms, misses, pairs}
  drillOffered: (data) => emit('drill.offered', data),                   // {accepted}
  practiceStarted: (data) => emit('practice.started', data),             // {mode, help, filter}
  practiceFailed: (data) => emit('practice.failed', data, 'warn'),
  wordsFailed: (data) => emit('words.failed', data, 'warn'),               // My words read refused/failed
};

export default wordLadderLog;
