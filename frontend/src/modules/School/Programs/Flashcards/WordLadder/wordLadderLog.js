/**
 * Word-ladder logging facade (pattern: Feed/Scroll/feedLog.js). Never raw
 * console.* — every event lands in the log store as `school.word-ladder.*`.
 *
 * Trace binding: `WordLadderProgram` creates one `createTrace()` at mount and
 * calls `setTrace(trace)` here — from then until `clearTrace(trace)` at
 * unmount, EVERY call below is routed through that trace's `event()`, so it
 * comes out stamped with `traceId`/`sittingId`/`seq`/`t`/`learnerId`/`deckId`/
 * `package`/`mode` (spec §8) without every call site having to thread the
 * trace through props or context. Outside a bound trace (a component
 * rendered on its own, as most of the item unit tests do) these fall back to
 * plain unstamped logging — unchanged from before this file gained a trace.
 */
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-word-ladder' });
  return _logger;
}

let activeTrace = null;
/** Bind the sitting's trace — everything emitted below is stamped from here on. */
export function setTrace(trace) { activeTrace = trace ?? null; }
/** Unbind, but only if `trace` is still the active one (a stale unmount must never clobber a newer trace). */
export function clearTrace(trace) { if (activeTrace === trace) activeTrace = null; }

function emit(event, data, level = 'info') {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  if (activeTrace) { activeTrace.event(event, payload, level); return; }
  logger()[level](`school.word-ladder.${event}`, payload);
}

export const wordLadderLog = {
  mounted: (data) => emit('mounted', data),
  unmounted: (data) => emit('unmounted', data),
  started: (data) => emit('started', data),                              // Start tapped
  sittingOpened: (data) => emit('sitting.opened', data),                 // spec §8 sitting.opened
  planFailed: (data) => emit('plan.failed', data, 'error'),
  writeFailed: (data) => emit('write.failed', data, 'warn'),
  sessionReopened: (data) => emit('session.reopened', data),
  apiRejected: (data) => emit('api.rejected', data, 'warn'),
  apiFailed: (data) => emit('api.failed', data, 'error'),
  layoutClamped: (data) => emit('layout.clamped', data, 'warn'),
  mediaFailed: (data) => emit('media.failed', data, 'warn'),        // image cue → text fallback
  promptFallback: (data) => emit('item.prompt-fallback', data, 'warn'), // cue asked for media that never resolved
  stageFailed: (data) => emit('stage.failed', data, 'warn'),
  itemShown: (data) => emit('item.shown', data),                        // {task, wordId, layout, media, fontPx}
  itemAnswered: (data) => emit('item.answered', data),                  // {response, correct?, score?, judge, ms}
  itemStalled: (data) => emit('item.stalled', data, 'warn'),            // {ms: 45000|120000}
  sittingClosed: (data) => emit('sitting.closed', data),                // {reason, activeMs, remaining}
  audioPlayed: (data) => emit('audio.played', data),                    // {kind, outcome: ended|error|blocked} — logged only from wordLadderAudio.js
  keypadToggled: (data) => emit('keypad.toggled', data),                // {auto, open}
  cardFlipped: (data) => emit('card.flipped', data),                    // {ms}
  cardSorted: (data) => emit('card.sorted', data),                      // {pile}
  cardUndone: (data) => emit('card.undone', data),
  roundStarted: (data) => emit('round.started', data),
  roundEnded: (data) => emit('round.ended', data),                      // {quizzed, notYet}
  noticeShown: (data) => emit('notice.shown', data, 'warn'),
  visibility: (data) => emit('visibility', data),                       // {state}
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
