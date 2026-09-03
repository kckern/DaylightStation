/**
 * continuationEntry — which entry a served subject continues to when its
 * token asked to continue.
 *
 * ONE rule for BOTH resolvers. `ResolveSubjectNext` (the scan path) and
 * `ResolveAccessCode#resolve` (the typed-code path) each carried an inline
 * copy of this fallback, kept in step by a mirror comment. The scan copy was
 * fixed to read `plan.entries`; the code copy kept reading the planner's
 * `inProgress`/`available` snapshots, which are frozen BEFORE
 * `appendAssignedProgramEntries` runs — so a child who had met the day's
 * reading obligation found the shelf closed at the wall panel, the path that
 * matters. A shared helper cannot drift.
 *
 * `plan.entries` is curriculum first, programs appended after, and the two
 * tie on priority. So a learner with an available english lesson AND the
 * shelf would get the lesson from a re-entered reading code — and a blanket
 * "prefer programs" would break `forwardAction`'s "Catch up" / "One more?"
 * tokens, which mint the same `continueToday` and mean a LESSON. The token
 * says what it wants: the daily reading code names its `program`, the
 * forward-action tokens do not.
 *
 * Not yet applied: the agenda withholds a program entry whose launcher
 * errored, but the section exposes only the boolean `programUnavailable`,
 * not the errored keys, so this helper cannot exclude them. When the section
 * names them, exclude them here — in one place.
 */
const CONTINUABLE = new Set(['in_progress', 'available']);

/**
 * @param {{ entries?: object[] }|null|undefined} plan
 * @param {object} [args]
 * @param {string} args.subject
 * @param {string|null} [args.program] program id the token named, if any
 * @returns {object|null} the entry to continue to, or null when nothing is eligible
 */
export function findContinuationEntry(plan, { subject, program = null } = {}) {
  // Filter, then ORDER THE WAY THE PLANNER DOES. The old typed-code fallback
  // read [...inProgress, ...available] with `available` already sorted by
  // effective priority; raw plan.entries is course order, and reading it
  // unsorted quietly changed which lesson a "Catch up" token opened. Decorate
  // with the original index so ties stay stable in entries order.
  const eligible = (plan?.entries ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry && CONTINUABLE.has(entry.status) && entry.subject === subject)
    .sort((left, right) => (
      (left.entry.status === 'in_progress' ? 0 : 1) - (right.entry.status === 'in_progress' ? 0 : 1)
      || (left.entry.timingPriority ?? 3) - (right.entry.timingPriority ?? 3)
      || (left.entry.timingRank ?? 0) - (right.entry.timingRank ?? 0)
      || left.index - right.index
    ))
    .map(({ entry }) => entry);
  if (program) {
    const wanted = eligible.find((entry) => entry.program === program);
    if (wanted) return wanted;
  }
  return eligible[0] ?? null;
}

export default findContinuationEntry;
