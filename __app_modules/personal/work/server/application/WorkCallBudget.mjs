import moment from 'moment-timezone';
import { workHash, workError, assertWorkUser } from '../domain/workState.mjs';
const scopes = new Set(['knowledge-extraction', 'journal-intent', 'workflow-rank']);
/** Attempts are reserved before any model await; failed calls consume the same receipt. */
export class WorkCallBudget {
  #state;
  #policy;
  #clock;
  constructor({
    state,
    resolvePolicy,
    clock
  }) {
    if (!state?.read || !state?.transact || typeof resolvePolicy !== 'function' || typeof clock !== 'function') throw new TypeError('Work call budget dependencies required');
    this.#state = state;
    this.#policy = resolvePolicy;
    this.#clock = clock;
  }
  async reserve({
    username,
    receiptId,
    scope
  }) {
    assertWorkUser(username);
    const policy = this.#policy(username),
      now = this.#clock();
    if (!policy.enabled) return {
      allowed: false,
      receiptId: null,
      reason: 'work_disabled'
    };
    if (typeof receiptId !== 'string' || !receiptId || receiptId.length > 100000 || !scopes.has(scope) || !Number.isFinite(now) || !moment.tz.zone(policy.timezone)) throw workError('INVALID_WORK_CALL');
    const id = 'call.' + workHash([username, scope, receiptId]),
      day = moment.tz(now, policy.timezone).format('YYYY-MM-DD');
    for (let n = 0; n < 8; n++) {
      const current = this.#policy(username);
      if (!current.enabled || current.timezone !== policy.timezone) return {
        allowed: false,
        receiptId: id,
        reason: 'policy_changed'
      };
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) return {
        allowed: false,
        receiptId: id,
        reason: 'state_unavailable'
      };
      if (state.calls?.[id]) return {
        allowed: false,
        receiptId: id,
        reason: 'already_reserved'
      };
      const used = Object.values(state.calls ?? {}).filter(call => call.day === day).length;
      if (used >= Math.min(4, current.limits.modelCallsPerLocalDay)) return {
        allowed: false,
        receiptId: id,
        reason: 'budget_exhausted'
      };
      try {
        const result = await this.#state.transact({
          username,
          id,
          expectedRevision: state.revision,
          events: [{
            type: 'call.reserved',
            call: {
              id,
              username,
              scope,
              day,
              at: now
            }
          }],
          asOf: now
        });
        return {
          allowed: result.applied,
          receiptId: id,
          ...(!result.applied ? {
            reason: 'already_reserved'
          } : {})
        };
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    return {
      allowed: false,
      receiptId: id,
      reason: 'budget_busy'
    };
  }
}
