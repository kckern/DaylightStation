/**
 * One trace per card-ladder sitting mount (spec §8 Events). Every event the
 * program or an item logs while this trace is active carries the same
 * `traceId`, an incrementing `seq`, and `t` (ms since the trace was created),
 * alongside the learner/deck/package/mode the sitting opened with — so
 * `school card-ladder trace` can reconstruct one sitting's timeline in order
 * across a reopen, a practice run, and every item in between.
 *
 * This module owns its own logger child rather than importing
 * `cardLadderLog.js`, so a trace can be created and asserted on in isolation
 * (no circular dependency on the facade that, in turn, binds a trace via
 * `cardLadderLog.setTrace`).
 */
import getLogger from '../../../../../lib/logging/Logger.js';
import { createTraceStamp } from '../../shared/traceStamp.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-card-ladder' });
  return _logger;
}

/**
 * `createTrace({ learnerId, deckId, mode }) → { id, setSitting(id), setPackage(pkg), event(name, data, level) }`
 *
 * `event()` stamps `data` with `{traceId, sittingId, seq, t, learnerId,
 * deckId, package, mode}` (the stamp wins over any colliding key in `data`)
 * and emits `school.card-ladder.<name>` through the shared logger child.
 * `seq` starts at 1 and increments on every call, including across a
 * `setSitting`/`setPackage` update — those just change what the NEXT event
 * stamps, they don't emit anything themselves.
 *
 * `mode` here is always the trace's own live/test — this is deliberate, not
 * a gotcha to fix. An event with something item-level to say about "mode"
 * (item.shown's intro/sort/practice, a say step, a practice run's mode)
 * must use a different key (`itemMode`, by convention — see
 * `cardLadderLog.js`), since this stamp silently overwrites `data.mode`.
 */
export function createTrace({ learnerId = null, deckId = null, mode = 'live' } = {}) {
  // The id, counter and clock are the shared stamp's (`shared/traceStamp.js`);
  // the word ladder's contract — the stamp wins over any colliding key — is
  // its default.
  const stamp = createTraceStamp({
    fields: {
      sittingId: null, learnerId, deckId, package: null, mode,
    },
  });

  return {
    id: stamp.id,
    setSitting(nextSittingId) { stamp.set({ sittingId: nextSittingId ?? null }); },
    setPackage(nextPackage) { stamp.set({ package: nextPackage ?? null }); },
    event(name, data = {}, level = 'info') {
      const stamped = stamp.stamp(data);
      logger()[level](`school.card-ladder.${name}`, stamped);
      return stamped;
    },
  };
}

export default createTrace;
