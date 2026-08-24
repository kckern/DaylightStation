/**
 * The learner-level "done for today" fact (design:
 * 2026-08-23-student-completion-state-machine-design). Pure fold over the
 * `obligation` field `planDailyAgenda` (agenda.mjs) computes per section —
 * no I/O, no clock, no persistence, purely derived so it can never strand an
 * earned unlock behind stale state.
 *
 * Three states, not a boolean, so an empty/broken plan cannot read as
 * "complete" (`no_work_today`), and a consumer can tell "finished real work"
 * apart from "had nothing to do".
 */

/**
 * @param {object} args
 * @param {Array<{subject: string|null, obligation: {state: string, reason: string|null}}>} args.sections
 * @param {string[]} [args.planErrors] - `planLearnerWork(...).errors`
 * @returns {{ state: 'incomplete'|'complete'|'no_work_today',
 *             excused: Array<{subject: string|null, reason: string}> }}
 */
export function resolveDayCompletion({ sections = [], planErrors = [] } = {}) {
  const pseudo = planErrors.length
    ? [{ subject: null, obligation: { state: 'excused', reason: 'plan_error' } }]
    : [];
  const all = [...sections, ...pseudo];
  const excused = all
    .filter((s) => s.obligation.state === 'excused')
    .map((s) => ({ subject: s.subject, reason: s.obligation.reason }));

  if (all.some((s) => s.obligation.state === 'obligated')) return { state: 'incomplete', excused };
  if (all.some((s) => s.obligation.state === 'served')) return { state: 'complete', excused };
  return { state: 'no_work_today', excused };
}

export default resolveDayCompletion;
