/**
 * Card-ladder logging facade (pattern: Feed/Scroll/feedLog.js). Never raw
 * console.* — every event lands in the log store as `school.card-ladder.*`.
 *
 * Trace binding: `CardLadderProgram` creates one `createTrace()` at mount and
 * calls `setTrace(trace)` here — from then until `clearTrace(trace)` at
 * unmount, EVERY call below is routed through that trace's `event()`, so it
 * comes out stamped with `traceId`/`sittingId`/`seq`/`t`/`learnerId`/`deckId`/
 * `package`/`mode` (spec §8) without every call site having to thread the
 * trace through props or context. Outside a bound trace (a component
 * rendered on its own, as most of the item unit tests do) these fall back to
 * plain unstamped logging — unchanged from before this file gained a trace.
 *
 * `mode` is reserved for the trace's own live/test stamp: `createTrace`'s
 * `event()` spreads it AFTER the caller's data, so any payload that also
 * used the key `mode` had that value silently discarded the moment a trace
 * was bound. Call sites that log an item-level mode (item.shown's
 * intro/sort/practice, a say step, a practice run's mode) use `itemMode`
 * instead — never `mode` — for exactly this reason.
 */
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-card-ladder' });
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
  logger()[level](`school.card-ladder.${event}`, payload);
}

export const cardLadderLog = {
  mounted: (data) => emit('mounted', data),
  unmounted: (data) => emit('unmounted', data),
  started: (data) => emit('started', data),                              // Start tapped
  introShown: (data) => emit('intro.shown', data),                       // start card drawn {hasPoster, newCount, reviewCount, learned, recognised, total}
  introFailed: (data) => emit('intro.failed', data, 'warn'),             // start card facts unavailable — the card falls back, Start still works
  stepEntered: (data) => emit('step.entered', data),                     // header step trail {step, round}
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
  itemShown: (data) => emit('item.shown', data),                        // {task, wordId, itemMode, layout, media, fontPx} — fontPx is always null here; see item.layout
  itemLayout: (data) => emit('item.layout', data),                      // {fontPx} — follow-up: the main FitText's first computed size for this item, once (see itemLayout.js)
  itemAnswered: (data) => emit('item.answered', data),                  // {response, correct?, score?, judge, ms}
  itemStalled: (data) => emit('item.stalled', data, 'warn'),            // {ms: 45000|120000}
  sittingClosed: (data) => emit('sitting.closed', data),                // {reason, activeMs, remaining}
  // {clip, trigger: auto|key|touch, input?, outcome: ended|error|blocked} — logged only from cardLadderAudio.js; a failed clip is warn.
  audioPlayed: (data) => emit('audio.played', data, data?.outcome === 'ended' ? 'info' : 'warn'),
  keypadToggled: (data) => emit('keypad.toggled', data),                // {auto, open, via?: 'long-press'}
  keyboardDetected: (data) => emit('keyboard.detected', data),          // once per device: a physical keyboard is known, keypad toggle hidden
  cardFlipped: (data) => emit('card.flipped', data),                    // {ms}
  cardSorted: (data) => emit('card.sorted', data),                      // {pile}
  cardUndone: (data) => emit('card.undone', data),
  roundStarted: (data) => emit('round.started', data),
  roundEnded: (data) => emit('round.ended', data),                      // {quizzed, notYet}
  noticeShown: (data) => emit('notice.shown', data, 'warn'),
  visibility: (data) => emit('visibility', data),                       // {state}
  // Spoken takes (never graded): {itemId, itemMode, phase: started|stopped|uploaded|failed|refused|unavailable, ms (since the item was shown),
  // durationMs?, bytes?, status?, reason?}. failed/unavailable are warn (unavailable: no mic, Space falls through to Skip).
  sayRecording: (data) => emit('say.recording', data, data?.phase === 'failed' || data?.phase === 'unavailable' ? 'warn' : 'info'),
  itemSkipped: (data) => emit('item.skipped', data),                     // {itemId, type, via, ms, what} — Skip on a say step with no take
  showMeUsed: (data) => emit('showme.used', data),                       // {itemId, via, ms} — gave up and asked to see the word
  resultShown: (data) => emit('result.shown', data),                     // {itemId, correct, score, judge, held} — the verdict panel on screen
  resultDismissed: (data) => emit('result.dismissed', data),             // {itemId, via, ms} — Next past a held verdict
  hintShown: (data) => emit('hint.shown', data),                         // {step} — a step's first-time hint
  matchCompleted: (data) => emit('match.completed', data),               // {ms, misses, pairs}
  drillOffered: (data) => emit('drill.offered', data),                   // {accepted}
  practiceStarted: (data) => emit('practice.started', data),             // {itemMode, help, filter}
  practiceFailed: (data) => emit('practice.failed', data, 'warn'),
  learnMoreStarted: (data) => emit('learn-more.started', data),         // {from: menu|summary, count} — one more guided round asked for
  learnMoreFailed: (data) => emit('learn-more.failed', data, 'warn'),   // {status, error}
  wordsFailed: (data) => emit('words.failed', data, 'warn'),               // My words read refused/failed
};

export default cardLadderLog;
