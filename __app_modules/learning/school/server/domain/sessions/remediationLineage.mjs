/**
 * Remediation lineage — how many times has a child already been sent back to
 * this unit? (failure policy: "two rounds, then a grown-up").
 *
 * A remediation session carries `remediationOf` on its `created` event, naming
 * the session it retries. The original sheet has none. So a session's DEPTH is
 * the number of `remediationOf` links between it and the original: 0 for the
 * first attempt, 1 for the first retry, 2 for the second.
 *
 * WHY THERE IS A CAP. A failed result used to offer "try again" forever. After
 * one learner scored 16.67% on a mastery quiz on 2026-09-26 the agenda printed
 * TRY AGAIN every day for four school days and he stopped coming to it; the
 * open item sat at the top of the subject, the day never completed, and his
 * games stayed locked behind it. Two fresh sheets that did not land are
 * evidence the child needs a person, not a third sheet. Past the cap the item
 * becomes a teacher hold: the child is no longer offered it, the day no longer
 * owes it, and it surfaces to the grown-up instead.
 *
 * Pure. Lookups are supplied by the caller; the I/O-backed walk that can read a
 * missing link from a session's own events lives in the application layer
 * (`application/remediationDepth.mjs`).
 */

/** `school.yml → lifecycle.remediation.maxRounds` when unset or unusable. */
export const DEFAULT_REMEDIATION_MAX_ROUNDS = 2;

/** A malformed lineage (a cycle written by hand) must never hang a planner. */
const MAX_WALK = 50;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

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

/**
 * Count the links from a session back to its original.
 *
 * `parentOf(sessionId)` answers the `remediationOf` of that session: a string
 * for a retry, null for an original or for a session the caller cannot see.
 * The walk counts the link it FOLLOWED before asking, so a parent that has
 * gone missing still counts as one round — the child holding the link is
 * itself the evidence that a round happened. Callers whose rows may omit the
 * field fill it in first (`application/remediationDepth.mjs`).
 *
 * @param {string|null|undefined} remediationOf - the starting session's own link
 * @param {(sessionId: string) => string|null|undefined} parentOf
 * @returns {number} 0 for an original
 */
export function walkRemediationLineage(remediationOf, parentOf) {
  let depth = 0;
  let cursor = remediationOf;
  const seen = new Set();
  while (isNonEmptyString(cursor) && !seen.has(cursor) && depth < MAX_WALK) {
    seen.add(cursor);
    depth += 1;
    cursor = parentOf(cursor);
  }
  return depth;
}

/**
 * Is this session's failure past the cap? Only a settled `needs_remediation`
 * result can be — a session still in flight, or one that passed, is not a
 * remediation decision at all.
 *
 * @param {{state?: string|null, outcome?: {result?: string}|null}} session
 * @param {number} depth
 * @param {number} maxRounds
 */
export function isPastRemediationCap(session, depth, maxRounds) {
  return session?.state === 'outcome_recorded'
    && session?.outcome?.result === 'needs_remediation'
    && depth >= maxRounds;
}
