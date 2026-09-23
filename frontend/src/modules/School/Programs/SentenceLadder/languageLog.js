/**
 * Language-study logging facade — categories over a child logger, same
 * pattern as schoolLog.js. Never use raw console.* for diagnostics.
 *
 * Every event carries the CURRENT RUN ID as `context.runId`, so one child's
 * session can be read end to end in the log store — frontend and backend
 * together — with `context.runId:"<id>"`. The id is minted once per program
 * run by the program shell (`languageLog.startRun()`) and is sent to the
 * backend on every request by `languageApi.js` as `X-School-Run-Id`. It
 * defaults to null: a module used outside a run still logs, just uncorrelated.
 *
 * THE RUN IS ALSO A TRACE (2026-09-23), like the word ladder's sitting trace
 * (`shared/traceStamp.js`). Every event emitted inside a run carries
 * `traceId` (the run id itself, so `data.traceId` and `context.runId` agree),
 * `traceSeq` (the event's order within the run), `t` (ms since the run
 * began), `learnerId`, `corpus`, and `day` (the ladder's day number, set once
 * the day loads). `traceSeq`, not `seq`: `seq` on these events is the
 * SENTENCE, and a stamp that overwrote it would erase the one fact every
 * capture line is about. A gap in `traceSeq` in the store is a debug event —
 * counted on the device, dropped at ingest. `school sentence-ladder trace`
 * orders by `traceSeq`, never by `_time`.
 */
import getLogger from '../../../../lib/logging/Logger.js';
import { createTraceStamp } from '../shared/traceStamp.js';

/**
 * Module-level, not React state: the api client is a plain module with no
 * access to a component tree, and a run is a singleton per page anyway — two
 * ladders are never open at once on the same surface.
 */
let currentRunId = null;
let trace = null;

function bindTrace(id, context = {}) {
  trace = id
    ? createTraceStamp({
      id,
      orderKey: 'traceSeq',
      overridable: true,
      fields: { learnerId: context.learnerId ?? null, corpus: context.corpus ?? null, day: context.day ?? null },
    })
    : null;
}

function newRunId() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  // Deliberately not a UUID shape: an environment without webcrypto should be
  // visibly distinguishable in the store rather than pretending to be one.
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logger() {
  return getLogger().child(
    currentRunId
      ? { component: 'school-language', runId: currentRunId }
      : { component: 'school-language' },
  );
}

function stamped(data, detail) {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  payload.detail = detail;
  return trace ? trace.stamp(payload) : payload;
}

function emit(category, detail, data, level = 'info') {
  const payload = stamped(data, detail);
  logger()[level](`school.language.${category}.${detail}`, payload);
}

// A refused keystroke is the evidence behind "it would not let me type", so it
// reaches the store — rate-limited, because a stuck child presses the same key
// again and again. At debug it never left the tablet, and a live report of
// exactly this (2026-09-14) had nothing to read.
function emitSampled(category, detail, data) {
  const payload = stamped(data, detail);
  logger().sampled(`school.language.${category}.${detail}`, payload, { maxPerMinute: 30, aggregate: true });
}

export const languageLog = {
  program: (detail, data) => emit('program', detail, data),              // mounted | unmounted | day-loaded
  // The same category one level down: the transitions BETWEEN those landmarks
  // — a day-load starting, the Review shelf being opened. Worth having while a
  // session is being read back, worth nothing the rest of the time, and the
  // store is a 7-day disk cap shared with every other household subsystem.
  programStep: (detail, data) => emit('program', detail, data, 'debug'),  // day-loading | tab
  programError: (detail, data) => emit('program', detail, data, 'error'), // day-failed
  // enter | selected | complete | held | replayed | advanced | practice |
  // stopped | idle-replay | glyph-replay | refused | peek
  rung: (detail, data) => (detail === 'refused' ? emitSampled('rung', detail, data) : emit('rung', detail, data, 'debug')),
  /**
   * The one rung fact the log STORE keeps. Everything else in this category is
   * `debug`, and debug never reaches the store — it is dropped at ingest,
   * whatever the browser is set to, so a raised level buys a console at the
   * device and nothing at all remotely. Which rung a child was standing on,
   * and why they were put there, is where a support call starts; it is not
   * allowed to be console-only. A handful per session, so the cost is nil.
   */
  rungLanded: (data) => emit('rung', 'landed', data),
  /** No key or touch on a sentence for 45 s / 120 s — see `useRungStall`. */
  rungStalled: (data) => emit('rung', 'stalled', data, 'warn'),
  attempt: (detail, data) => emit('attempt', detail, data, 'debug'),     // saved
  attemptError: (detail, data) => emit('attempt', detail, data, 'error'), // record-failed
  audio: (detail, data) => emit('audio', detail, data, 'debug'),         // play | ended | preload
  audioError: (detail, data) => emit('audio', detail, data, 'warn'),     // play-blocked | load-failed
  // Recording rung, one line per step — see the reference doc's "Recording
  // observability" for the vocabulary: cut | start | stop | piece-stop |
  // piece-next | piece-redo | piece-resume | retake | replay-restart |
  // compare | stitched | refused | keep | playback | review-idle |
  // silent-warning | silent-cleared | pieces-abandoned | stitch-failed.
  capture: (detail, data) => emit('capture', detail, data),
  captureError: (detail, data) => emit('capture', detail, data, 'error'), // denied | failed
  pacing: (detail, data) => emit('pacing', detail, data),                // changed | rolled
  // A refusal is not a fault — the server is doing its job when it declines to
  // roll a day early — but it is the exact shape of "I pressed it and nothing
  // happened", which is what a child reports. It must not be filtered away with
  // the per-sentence traffic.
  pacingWarn: (detail, data) => emit('pacing', detail, data, 'warn'),    // roll-refused | change-failed
  capability: (detail, data) => emit('capability', detail, data),        // detected | restored | overridden | rung-blocked
  api: (detail, data) => emit('api', detail, data, 'debug'),             // ok | aborted
  apiWarn: (detail, data) => emit('api', detail, data, 'warn'),          // rejected (a non-ok response)
  apiError: (detail, data) => emit('api', detail, data, 'error'),        // failed (nothing came back)

  /**
   * Mint and install a run id, and open its trace with `{learnerId, corpus}`.
   * Returns the id, so the caller can render/report it.
   */
  startRun(context = {}) {
    currentRunId = newRunId();
    bindTrace(currentRunId, context);
    return currentRunId;
  },
  /** Install an id minted elsewhere (e.g. one handed over by a launch). */
  setRun(id, context = {}) {
    currentRunId = id || null;
    bindTrace(currentRunId, context);
    return currentRunId;
  },
  /** Change what the run's LATER events carry — `{day}` once the day loads. */
  setTraceContext(patch) {
    trace?.set(patch);
  },
  /** The id every event and every outbound request is currently tagged with. */
  currentRun() {
    return currentRunId;
  },
  /** End the run. Later events are uncorrelated rather than mis-correlated. */
  endRun() {
    currentRunId = null;
    trace = null;
  },
};

export default languageLog;
