/**
 * The interface every School program plugs into so the daily agenda can offer
 * "go do this" without knowing what any individual program does or where it
 * lives.
 *
 * A launcher answers two questions for one learner: is today's work for this
 * program already done, and — if not — how do we hand the learner off to it?
 * `status` is read-only and safe to call speculatively (agenda compilation,
 * dashboards); `launch` has a side effect (it dispatches the learner
 * somewhere) and should only be called on an actual "go" action.
 *
 * The status shape is intentionally the same shape `planDailyAgenda` already
 * consumes as `programStatuses` — `{ doneToday, progressLabel, score }` — so a
 * launcher's `status()` can be wired straight into agenda compilation without
 * an adapter in between. `score` is a 0–1 ratio when the program can produce
 * one, and `null` when it cannot (a language ladder does not grade; a
 * question bank does).
 *
 * @interface IProgramLauncher
 */
export class IProgramLauncher {
  /** Stable id, e.g. 'language'. Matches the id an `IProgramReporter` for the
   * same program would use, so the two can be keyed together. */
  get id() {
    throw new Error('IProgramLauncher.id must be implemented');
  }

  /**
   * Today's status for one learner. Must not throw: agenda compilation calls
   * every launcher, and one failing program must not blank the agenda for the
   * rest.
   *
   * @param {{userId: string}} args
   * @returns {Promise<{doneToday: boolean, progressLabel: string|null, score: number|null}>}
   */
  // eslint-disable-next-line no-unused-vars
  status({ userId }) {
    throw new Error('IProgramLauncher.status must be implemented');
  }

  /**
   * Hand the learner off to the program — dispatch it to wherever this
   * learner studies (a portal target, a kiosk screen, a bank session).
   *
   * Routes through `DoNowService.dispatch` (spec §6 last bullet — "program
   * launchers become DoNow callers where they dispatch surfaces"), so the
   * return value is DoNow's own contract result, not a bare boolean: the
   * caller (`ResolveScanAction`) must branch on `decision` to slip the right
   * wording for a busy surface exactly as a `launch:` unit's one-shot
   * dispatch does.
   *
   * @param {{userId: string}} args
   * @returns {Promise<{decision: 'dispatched'|'pending_approval'|'denied'|'failed',
   *                     approvalId?: string, message: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  launch({ userId }) {
    throw new Error('IProgramLauncher.launch must be implemented');
  }
}

export function isProgramLauncher(obj) {
  return Boolean(obj)
    && typeof obj.status === 'function'
    && typeof obj.launch === 'function'
    && typeof obj.id === 'string';
}

export default IProgramLauncher;
