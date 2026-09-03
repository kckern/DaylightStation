// backend/src/3_applications/nutribot/lib/unsettledStamp.mjs
//
// THE ACCEPT-SEAM STAMP, extracted so there is exactly one of it.
//
// Phase 1 gave every AI capture (text / voice / image / barcode) an auto-commit seam in
// `NutribotInputRouter`: stamp every item `settled: false`, then run the same accept path
// `AcceptFoodLog` uses. Phase 5's `ObservationService` finalises a kitchen-scale
// composition into an entry that must be indistinguishable from those captures — same
// `status: 'accepted'`, same `settled: false` — and the brief for that task is explicit
// that it REUSES this seam rather than growing a second commit path beside it.
//
// The router's version was a private method on an event-shaped class, so a scale commit
// could not call it. Rather than copy the six lines (and let the two drift the first time
// either changes), the body lives here and BOTH callers delegate to it.
//
// ## `settled: false` is written VERBATIM — never `?? false`, never `?? null`
//
// An ABSENT `settled` key is the migration signal for a legacy row: `settlement.mjs` and
// `ObservationMatcher` both read absence as "treat as settled / already reviewed". A
// default would stamp every historical row as unsettled the first time anything touched
// it, and re-open the entire back catalogue for automatic re-pairing.

import { serializeFoodItem } from '../nutriLogRecords.mjs';

/**
 * Stamp `settled: false` on every item of a log, in place.
 *
 * Best-effort by design, exactly as the router's original was: a stamp failure must not
 * turn a captured (or committed) meal into a thrown request. It returns `[]` rather than
 * throwing, and the caller carries on.
 *
 * @param {object} args
 * @param {{findByUuid: Function, save: Function}|null} args.foodLogStore
 * @param {string} args.userId
 * @param {string} args.logId
 * @param {string} args.source Capture kind, for the log line (`text`/`voice`/`scale`/…).
 * @param {object} [args.logger] Injected logger. `debug` on success, `warn` on failure.
 * @returns {Promise<object[]>} The stamped item records, or `[]` when nothing was stamped.
 */
export async function stampUnsettled({ foodLogStore, userId, logId, source, logger = console }) {
  if (!foodLogStore?.findByUuid || !foodLogStore?.save) return [];

  try {
    const log = await foodLogStore.findByUuid(logId, userId);
    if (!log?.items?.length) return [];
    const items = log.items.map((item) => ({ ...serializeFoodItem(item), settled: false }));
    await foodLogStore.save(log.updateItems(items, new Date()));
    logger.debug?.('nutribot.capture.unsettledStamped', { source, logId, itemCount: items.length });
    return items;
  } catch (e) {
    logger.warn?.('nutribot.capture.stampFailed', { source, logId, error: e.message });
    return [];
  }
}

export default stampUnsettled;
