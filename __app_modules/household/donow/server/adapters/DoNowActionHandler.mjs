/**
 * The Approve / Deny press on a DoNow approval push (Android app). The action id
 * names the request: `DONOW_APPROVE_<id>` / `DONOW_DENY_<id>`.
 */
const ACTION = /^DONOW_(APPROVE|DENY)_(.+)$/;

export class DoNowActionHandler {
  #approvals;
  #logger;

  constructor({ approvals, logger } = {}) {
    if (!approvals) throw new Error('DoNowActionHandler requires approvals');
    this.#approvals = approvals;
    this.#logger = logger;
  }

  matches(actionId) { return ACTION.test(actionId); }

  async handle({ actionId }) {
    const [, verb, id] = actionId.match(ACTION);
    const result = verb === 'APPROVE' ? await this.#approvals.approve({ id }) : await this.#approvals.deny({ id });
    this.#logger?.info?.('donow.approval.from-notification', { id, verb: verb.toLowerCase(), decision: result?.decision ?? null });
    return result?.decision === 'expired' ? { ok: false, code: 'ALREADY_DECIDED' } : { ok: true };
  }
}
