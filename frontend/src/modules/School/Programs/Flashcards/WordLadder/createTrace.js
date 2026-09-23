/**
 * One trace per word-ladder sitting mount (spec §8 Events). Every event the
 * program or an item logs while this trace is active carries the same
 * `traceId`, an incrementing `seq`, and `t` (ms since the trace was created),
 * alongside the learner/deck/package/mode the sitting opened with — so
 * `school word-ladder trace` can reconstruct one sitting's timeline in order
 * across a reopen, a practice run, and every item in between.
 *
 * This module owns its own logger child rather than importing
 * `wordLadderLog.js`, so a trace can be created and asserted on in isolation
 * (no circular dependency on the facade that, in turn, binds a trace via
 * `wordLadderLog.setTrace`).
 */
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-word-ladder' });
  return _logger;
}

function randomTraceId() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let id = '';
  while (id.length < 12) id += Math.floor(Math.random() * 16).toString(16);
  return id.slice(0, 12);
}

/**
 * `createTrace({ learnerId, deckId, mode }) → { id, setSitting(id), setPackage(pkg), event(name, data, level) }`
 *
 * `event()` stamps `data` with `{traceId, sittingId, seq, t, learnerId,
 * deckId, package, mode}` (the stamp wins over any colliding key in `data`)
 * and emits `school.word-ladder.<name>` through the shared logger child.
 * `seq` starts at 1 and increments on every call, including across a
 * `setSitting`/`setPackage` update — those just change what the NEXT event
 * stamps, they don't emit anything themselves.
 *
 * `mode` here is always the trace's own live/test — this is deliberate, not
 * a gotcha to fix. An event with something item-level to say about "mode"
 * (item.shown's intro/sort/practice, a say step, a practice run's mode)
 * must use a different key (`itemMode`, by convention — see
 * `wordLadderLog.js`), since this stamp silently overwrites `data.mode`.
 */
export function createTrace({ learnerId = null, deckId = null, mode = 'live' } = {}) {
  const id = randomTraceId();
  const startedAt = Date.now();
  let sittingId = null;
  let pkg = null;
  let seq = 0;

  return {
    id,
    setSitting(nextSittingId) { sittingId = nextSittingId ?? null; },
    setPackage(nextPackage) { pkg = nextPackage ?? null; },
    event(name, data = {}, level = 'info') {
      seq += 1;
      const stamped = {
        ...data,
        traceId: id,
        sittingId,
        seq,
        t: Date.now() - startedAt,
        learnerId,
        deckId,
        package: pkg,
        mode,
      };
      logger()[level](`school.word-ladder.${name}`, stamped);
      return stamped;
    },
  };
}

export default createTrace;
