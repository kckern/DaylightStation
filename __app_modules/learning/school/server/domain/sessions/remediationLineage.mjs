/**
 * Remediation holds — when does a failed unit stop being the child's job and
 * become a grown-up's? (failure policy: "two rounds, or three idle days, then
 * a grown-up").
 *
 * A remediation session carries `remediationOf` on its `created` event, naming
 * the session it retries. The original sheet has none. So a session's DEPTH is
 * the number of `remediationOf` links between it and the original: 0 for the
 * first attempt, 1 for the first retry, 2 for the second.
 *
 * Two things turn an open failure into a TEACHER HOLD:
 *
 *   - `cap`: it is already `maxRounds` retries deep. Fresh sheets that did not
 *     land are evidence the child needs a person, not another sheet. The
 *     retry is withdrawn outright — `OpenRemediation` refuses it.
 *   - `stale`: nobody has retried it for `holdAfterStudyDays` school days. A
 *     child avoiding a retry is also a child who needs a person. The retry is
 *     NOT withdrawn — a child who comes back with the ticket may still use it
 *     — but it stops being owed, so it can no longer hold the day shut.
 *
 * WHY. On 2026-09-26 one learner scored 16.67% on a mastery quiz. The failure
 * sat at depth 0, unretried, and the agenda printed TRY AGAIN at the top of
 * the subject every school day from 9/29 to 10/02. He never took it. The day
 * could not complete while it was owed, so his games stayed locked behind work
 * he was plainly not going to do alone. The stale rule is what would have
 * caught that; the cap catches the other way the same loop runs forever.
 *
 * Either way the item stops obligating the day and surfaces to the grown-up.
 *
 * Pure. Lookups are supplied by the caller; the I/O-backed walk that can read a
 * missing link from a session's own events lives in the application layer
 * (`application/remediationDepth.mjs`).
 */

/** `school.yml → lifecycle.remediation.maxRounds` when unset or unusable. */
export const DEFAULT_REMEDIATION_MAX_ROUNDS = 2;
/** `school.yml → lifecycle.remediation.holdAfterStudyDays` when unset or unusable. */
export const DEFAULT_REMEDIATION_HOLD_AFTER_STUDY_DAYS = 3;

/** A malformed lineage (a cycle written by hand) must never hang a planner. */
const MAX_WALK = 50;
/** No failure is examined further back than this; it is long since stale. */
const MAX_IDLE_SCAN = 400;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The configured cap, normalised. Anything but a positive integer falls back
 * to the default rather than to "no cap": a typo in the YAML must not quietly
 * restore the endless loop the cap exists to end.
 *
 * @param {unknown} raw
 * @returns {number}
 */
export function remediationMaxRounds(raw) {
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_REMEDIATION_MAX_ROUNDS;
}

/** The configured idle window, normalised the same way. */
export function remediationHoldAfterStudyDays(raw) {
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_REMEDIATION_HOLD_AFTER_STUDY_DAYS;
}

/**
 * Count the links from a session back to its original.
 *
 * `parentOf(sessionId)` answers the `remediationOf` of that session: a string
 * for a retry, null for an original or for a session the caller cannot see.
 * The walk counts the link it FOLLOWED before asking, so a parent that has
 * gone missing still counts as one round — the child holding the link is
 * itself the evidence that a round happened. Callers whose rows may omit the
 * field fill it in first (`application/remediationDepth.mjs`). A cycle ends
 * the walk at the first repeated session.
 *
 * @param {string|null|undefined} remediationOf - the starting session's own link
 * @param {(sessionId: string) => string|null|undefined} parentOf
 * @param {{limit?: number}} [options] - stop once this deep; a caller that only
 *   needs "at the cap or not" passes the cap
 * @returns {number} 0 for an original
 */
export function walkRemediationLineage(remediationOf, parentOf, { limit = MAX_WALK } = {}) {
  const ceiling = Math.min(limit, MAX_WALK);
  let depth = 0;
  let cursor = remediationOf;
  const seen = new Set();
  while (isNonEmptyString(cursor) && !seen.has(cursor) && depth < ceiling) {
    seen.add(cursor);
    depth += 1;
    cursor = parentOf(cursor);
  }
  return depth;
}

/**
 * School days that have fully passed since a failure was recorded: the days
 * strictly after `fromDay` and strictly before `today` that `isSchoolDay`
 * accepts. Today does not count — the child still has it.
 *
 * Stops counting at `limit`, since a caller only asks "has it reached N".
 *
 * @param {object} args
 * @param {string|null} args.fromDay - study day the failure was recorded on
 * @param {string|null} args.today - the current study day
 * @param {(day: string) => boolean} [args.isSchoolDay]
 * @param {number} [args.limit]
 * @returns {number|null} null when either day is unknown
 */
export function idleSchoolDays({ fromDay, today, isSchoolDay = () => true, limit = MAX_IDLE_SCAN } = {}) {
  if (!DAY_KEY.test(fromDay ?? '') || !DAY_KEY.test(today ?? '')) return null;
  let count = 0;
  let scanned = 0;
  for (let day = nextDay(fromDay); day < today && count < limit && scanned < MAX_IDLE_SCAN; day = nextDay(day)) {
    scanned += 1;
    if (isSchoolDay(day)) count += 1;
  }
  return count;
}

/** An open, settled `needs_remediation` result — the only thing that can be held. */
export function isOpenFailure(session) {
  return Boolean(session) && !session.terminal
    && session.state === 'outcome_recorded'
    && session.outcome?.result === 'needs_remediation';
}

/**
 * Why this failure is a teacher hold, or null if it is not one. `cap` wins
 * over `stale`: it is the stronger statement (the retry is withdrawn, not just
 * no longer owed).
 *
 * @param {object} args
 * @param {object} args.session - a derived session fact
 * @param {number} args.depth
 * @param {number|null} [args.idleStudyDays]
 * @param {number} args.maxRounds
 * @param {number} [args.holdAfterStudyDays]
 * @returns {'cap'|'stale'|null}
 */
export function remediationHoldReason({
  session, depth, idleStudyDays = null, maxRounds,
  holdAfterStudyDays = DEFAULT_REMEDIATION_HOLD_AFTER_STUDY_DAYS,
}) {
  if (!isOpenFailure(session)) return null;
  if (depth >= maxRounds) return 'cap';
  if (idleStudyDays != null && idleStudyDays >= holdAfterStudyDays) return 'stale';
  return null;
}

/** "1 retry", "2 retries" — the words every surface uses for a depth. */
export function retriesPhrase(depth) {
  return `${depth} ${depth === 1 ? 'retry' : 'retries'}`;
}
