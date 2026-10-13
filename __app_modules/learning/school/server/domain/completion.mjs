/**
 * The learner-level "done for today" fact (design:
 * 2026-08-23-student-completion-state-machine-design). Pure fold over the
 * `obligation` field `planDailyAgenda` (agenda.mjs) computes per section —
 * no I/O, no clock, no persistence, purely derived so it can never strand an
 * earned unlock behind stale state.
 *
 * Four states, not a boolean. `indeterminate` is deliberately distinct from
 * `no_work_today`: a broken plan or unavailable required program is not
 * evidence that a learner had nothing assigned.
 */

/**
 * @param {object} args
 * @param {Array<{subject: string|null, obligation: {state: string, reason: string|null}}>} args.sections
 * @param {string[]} [args.planErrors] - `planLearnerWork(...).errors`
 * @returns {{ state: 'indeterminate'|'incomplete'|'complete'|'no_work_today',
 *             excused: Array<{subject: string|null, reason: string}>,
 *             faults: Array<{subject: string|null, reason: string}> }}
 */
export function resolveDayCompletion({ sections = [], planErrors = [] } = {}) {
  const pseudo = planErrors.length
    ? [{ subject: null, obligation: { state: 'faulted', reason: 'plan_error' } }]
    : [];
  const all = [...sections, ...pseudo];
  const excused = all
    .filter((s) => s.obligation.state === 'excused')
    .map((s) => ({ subject: s.subject, reason: s.obligation.reason }));
  const faults = all
    .filter((s) => s.obligation.state === 'faulted')
    .map((s) => ({ subject: s.subject, reason: s.obligation.reason }));

  if (faults.length) return { state: 'indeterminate', excused, faults };
  if (all.some((s) => s.obligation.state === 'obligated')) return { state: 'incomplete', excused, faults };
  if (all.some((s) => s.obligation.state === 'served')) return { state: 'complete', excused, faults };
  return { state: 'no_work_today', excused, faults };
}

export default resolveDayCompletion;
