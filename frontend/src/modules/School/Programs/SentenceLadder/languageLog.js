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
 */
import getLogger from '../../../../lib/logging/Logger.js';

/**
 * Module-level, not React state: the api client is a plain module with no
 * access to a component tree, and a run is a singleton per page anyway — two
 * ladders are never open at once on the same surface.
 */
let currentRunId = null;

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
  api: (detail, data) => emit('api', detail, data, 'debug'),             // ok | aborted
  apiWarn: (detail, data) => emit('api', detail, data, 'warn'),          // rejected (a non-ok response)
  apiError: (detail, data) => emit('api', detail, data, 'error'),        // failed (nothing came back)

  /** Mint and install a run id. Returns it, so the caller can render/report it. */
  startRun() {
    currentRunId = newRunId();
    return currentRunId;
  },
  /** Install an id minted elsewhere (e.g. one handed over by a launch). */
  setRun(id) {
    currentRunId = id || null;
    return currentRunId;
  },
  /** The id every event and every outbound request is currently tagged with. */
  currentRun() {
    return currentRunId;
  },
  /** End the run. Later events are uncorrelated rather than mis-correlated. */
  endRun() {
    currentRunId = null;
  },
};

export default languageLog;
