/**
 * The I/O half of the remediation cap (`domain/sessions/remediationLineage.mjs`).
 *
 * The planner counts rounds over the session rows it is handed, which carry
 * `remediationOf` (`IWorkSessionRepository.listForLearner`). Two things need
 * more than that:
 *
 *   - a use case holding ONE reduced session and no rows (`OpenRemediation`,
 *     `CloseSessionOutcome`), which walks the links by reading each parent's
 *     events — two or three small reads at most, since the cap stops the
 *     chain growing;
 *   - `PlanProjection`, whose rows may come from a store that does not supply
 *     the field. Absent means UNKNOWN, never "original": treating it as an
 *     original would under-count and print a third TRY AGAIN, which is the
 *     failure the cap exists to end. So the links on the path of an open
 *     failure are read from events before the planner sees them. The YAML
 *     store always supplies the field, so in production this reads nothing.
 */
import { reduceSession } from "../domain/sessions/sessionEvents.mjs";

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const MAX_WALK = 50;

async function linkFromEvents(sessions, sessionId) {
  if (typeof sessions?.readEvents !== 'function') return null;
  const events = await sessions.readEvents(sessionId);
  return events?.length ? (reduceSession(events).remediationOf ?? null) : null;
}

/**
 * Rounds behind a session, from its own `remediationOf`: 0 for an original.
 * Each link followed counts, whether or not the parent can still be read.
 *
 * Stops at `limit`: a caller passes the cap plus `REMEDIATION_COUNT_HEADROOM`,
 * enough to decide the cap and still say how many retries there really were,
 * without reading the whole history back to the first sheet.
 *
 * @param {string|null|undefined} remediationOf
 * @param {{readEvents: Function}} sessions
 * @param {{limit?: number}} [options]
 * @returns {Promise<number>}
 */
export async function remediationDepthOf(remediationOf, sessions, { limit = MAX_WALK } = {}) {
  const ceiling = Math.min(limit, MAX_WALK);
  let depth = 0;
  let cursor = remediationOf;
  const seen = new Set();
  while (isNonEmptyString(cursor) && !seen.has(cursor) && depth < ceiling) {
    seen.add(cursor);
    depth += 1;
    // eslint-disable-next-line no-await-in-loop
    cursor = await linkFromEvents(sessions, cursor);
  }
  return depth;
}

const isOpenFailure = (row) => !row?.terminal && row?.state === 'outcome_recorded'
  && row?.outcome?.result === 'needs_remediation';

/**
 * Fill in `remediationOf` wherever a row on an open failure's lineage left it
 * out. Rows that carry the key (null included) are trusted as they are, so a
 * store that supplies it costs nothing. Returns the input array untouched when
 * there was nothing to fill.
 *
 * @param {object[]} rows - `listForLearner` rows
 * @param {{readEvents: Function}} sessions
 * @returns {Promise<object[]>}
 */
export async function withRemediationLineage(rows, sessions) {
  const byId = new Map(rows.filter((row) => isNonEmptyString(row?.sessionId)).map((row) => [row.sessionId, row]));
  const filled = new Map();
  for (const start of rows.filter(isOpenFailure)) {
    let row = start;
    const seen = new Set();
    while (row && !seen.has(row.sessionId) && seen.size < MAX_WALK) {
      seen.add(row.sessionId);
      let link = filled.has(row.sessionId) ? filled.get(row.sessionId) : row.remediationOf;
      if (link === undefined) {
        // eslint-disable-next-line no-await-in-loop
        link = await linkFromEvents(sessions, row.sessionId);
        filled.set(row.sessionId, link);
      }
      row = isNonEmptyString(link) ? byId.get(link) ?? null : null;
    }
  }
  if (!filled.size) return rows;
  return rows.map((row) => (filled.has(row.sessionId) ? { ...row, remediationOf: filled.get(row.sessionId) } : row));
}
