import moment from 'moment-timezone';
import { attentionEligibility, mergeAttentionHistory } from '../domain/attentionPolicy.mjs';
import { workHash, workError, assertWorkUser } from '../domain/workState.mjs';
const channels = new Set(['morning', 'housekeeping', 'review', 'direct_request', 'echo', 'quiz']);
/** Canonical reservations fence sends; acknowledged exposure remains a separate fact. */
export class AttentionBudget {
  #state;
  #history;
  #timezone;
  #policy;
  #clock;
  constructor({
    state,
    history,
    userTimezone,
    resolvePolicy,
    clock = Date.now
  }) {
    if (!state?.transact || !history?.read || typeof userTimezone !== 'function' || typeof resolvePolicy !== 'function' || typeof clock !== 'function') throw new TypeError('Attention dependencies required');
    this.#state = state;
    this.#history = history;
    this.#timezone = userTimezone;
    this.#policy = resolvePolicy;
    this.#clock = clock;
  }
  #day(username, at) {
    const timezone = this.#timezone(username);
    if (!Number.isFinite(at) || !moment.tz.zone(timezone)) throw workError('INVALID_ATTENTION_TIME');
    return moment.tz(at, timezone).format('YYYY-MM-DD');
  }
  async history({
    username,
    asOf = this.#clock()
  }) {
    const policy = this.#policy(username);
    if (!policy.enabled) return {
      available: false,
      records: [],
      unansweredInvitations: []
    };
    const state = await this.#state.read({
      username
    });
    if (!state.health.available) return {
      available: false,
      records: [],
      unansweredInvitations: []
    };
    const owner = await this.#history.read({
      username,
      askDate: this.#day(username, asOf),
      asOf
    });
    return {
      available: owner.available !== false,
      records: mergeAttentionHistory(Object.values(state.attention ?? {}), owner),
      unansweredInvitations: owner.unansweredInvitations ?? []
    };
  }
  async reserve({
    username,
    decisionId,
    channel,
    questionUnits,
    refKey = null,
    flowType,
    expiresAt
  }) {
    assertWorkUser(username);
    const now = this.#clock(),
      day = this.#day(username, now),
      policy = this.#policy(username),
      revision = policy.revision;
    const denied = (reason, reservationId = null) => ({
      allowed: false,
      reservationId,
      reason
    });
    if (!policy.enabled) return denied('work_disabled');
    if (typeof decisionId !== 'string' || !decisionId || decisionId.length > 1024 || !channels.has(channel) || !Number.isInteger(questionUnits) || questionUnits < 0 || questionUnits > 5 || typeof flowType !== 'string' || !flowType || flowType.length > 64 || refKey !== null && (typeof refKey !== 'string' || refKey.length > 2048) || !Number.isFinite(expiresAt) || expiresAt <= now) throw workError('INVALID_ATTENTION_RESERVATION');
    if (questionUnits === 0) return {
      allowed: true,
      reservationId: null,
      reason: 'empty'
    };
    const id = 'attention.' + workHash([username, decisionId, day]);
    for (let n = 0; n < 8; n++) {
      const current = this.#policy(username);
      if (!current.enabled || current.revision !== revision || this.#day(username, this.#clock()) !== day) return denied('policy_or_day_changed');
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) return denied('state_unavailable');
      const same = Object.values(state.attention ?? {}).filter(r => r.decisionId === decisionId);
      const previous = same.find(r => r.id === id);
      if (previous) return denied(previous.status === 'prepared' && previous.expiresAt > now ? 'already_reserved' : previous.status, id);
      if (same.some(r => ['prepared', 'dispatching', 'quarantined', 'delivered', 'responded'].includes(r.status))) return denied('already_reserved', same[0].id);
      const manual = ['direct_request', 'echo', 'quiz'].includes(channel);
      const history = manual ? {
        available: true,
        deliveries: [],
        reservations: [],
        unansweredInvitations: []
      } : await this.#history.read({
        username,
        askDate: day,
        asOf: now
      });
      if (history.available === false) return denied('history_unavailable');
      if (!manual && channel !== 'morning' && (history.unansweredInvitations?.length || Object.values(state.attention ?? {}).some(r => r.channel !== 'morning' && !r.response && (['dispatching', 'quarantined'].includes(r.status) || r.expiresAt > now && ['prepared', 'delivered'].includes(r.status))))) return denied('pending_invitation');
      const eligible = attentionEligibility({
        records: mergeAttentionHistory(Object.values(state.attention ?? {}), history),
        policy: {
          ...current.attention,
          maxProactiveUnitsPerDay: Math.min(current.attention.maxProactiveUnitsPerDay ?? 2, history.maxQuestionUnits ?? 2)
        },
        day,
        asOf: now,
        channel,
        questionUnits,
        refKey,
        flowType
      });
      if (!eligible.allowed) return denied(eligible.reason);
      const latest = this.#policy(username);
      if (!latest.enabled || latest.revision !== revision || this.#day(username, this.#clock()) !== day) return denied('policy_or_day_changed');
      const reservation = {
        id,
        username,
        decisionId,
        day,
        channel,
        flowType,
        questionUnits,
        refKey,
        policyRevision: revision,
        createdAt: now,
        expiresAt: Math.min(expiresAt, now + Math.min(24, current.attention.offerExpiryHours) * 3600000),
        status: 'prepared',
        deliveredAt: null,
        botMessageId: null,
        response: null
      };
      const events = [...same.filter(r => r.status === 'prepared').map(r => ({
        type: 'attention.failed',
        reservationId: r.id,
        uncertain: false,
        at: now
      })), {
        type: 'attention.reserved',
        reservation
      }];
      try {
        const result = await this.#state.transact({
          username,
          id: 'attention:reserve:' + id,
          expectedRevision: state.revision,
          events,
          asOf: now
        });
        return result.applied ? {
          allowed: true,
          reservationId: id,
          reason: null
        } : denied('already_reserved', id);
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    return denied('contention');
  }
  async dispatch({
    username,
    reservationId
  }) {
    let allowed = false,
      dispatchRevision,
      dispatchExpiresAt;
    const now = this.#clock();
    const history = await this.#history.read({
      username,
      askDate: this.#day(username, now),
      asOf: now
    });
    if (history.available === false) return {
      allowed: false
    };
    const result = await this.#change(username, reservationId, 'dispatch', now, (row, state) => {
      allowed = false;
      const policy = this.#policy(username);
      if (row.status !== 'prepared' || row.expiresAt <= now || row.day !== this.#day(username, this.#clock()) || row.expiresAt <= this.#clock() || !policy.enabled || row.policyRevision !== policy.revision) return null;
      const records = mergeAttentionHistory(Object.values(state.attention ?? {}), history).filter(r => r.id !== reservationId);
      if (!attentionEligibility({
        records,
        policy: {
          ...policy.attention,
          maxProactiveUnitsPerDay: Math.min(2, policy.attention.maxProactiveUnitsPerDay ?? 2, history.maxQuestionUnits ?? 2)
        },
        day: row.day,
        asOf: now,
        channel: row.channel,
        flowType: row.flowType,
        questionUnits: row.questionUnits,
        refKey: row.refKey
      }).allowed) return null;
      allowed = true;
      dispatchRevision = policy.revision;
      dispatchExpiresAt = row.expiresAt;
      return {
        type: 'attention.dispatching',
        reservationId,
        at: now
      };
    });
    if (allowed && result.applied && (this.#day(username, this.#clock()) !== this.#day(username, now) || dispatchExpiresAt <= this.#clock() || !this.#policy(username).enabled || this.#policy(username).revision !== dispatchRevision)) {
      await this.fail({
        username,
        reservationId,
        uncertain: false,
        asOf: this.#clock()
      });
      return {
        allowed: false
      };
    }
    return {
      allowed: allowed && result.applied === true
    };
  }
  async #change(username, reservationId, kind, at, build) {
    assertWorkUser(username);
    for (let n = 0; n < 8; n++) {
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      const row = state.attention?.[reservationId];
      if (!row) throw workError('ATTENTION_UNKNOWN');
      const event = build(row, state);
      if (!event) return {
        applied: false
      };
      try {
        return await this.#state.transact({
          username,
          id: 'attention:' + kind + ':' + workHash([reservationId, event]),
          expectedRevision: state.revision,
          events: [event],
          asOf: at
        });
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    throw workError('STALE_WORK_REVISION');
  }
  acknowledge({
    username,
    reservationId,
    botMessageId,
    deliveredAt
  }) {
    const day = this.#day(username, deliveredAt);
    if (!/^[1-9][0-9]*$/.test(String(botMessageId))) throw workError('ATTENTION_ACK_REQUIRED');
    return this.#change(username, reservationId, 'ack', deliveredAt, row => {
      if (row.status === 'delivered') {
        if (row.botMessageId !== String(botMessageId)) throw workError('ATTENTION_ACK_MISMATCH');
        return null;
      }
      if (!['prepared', 'dispatching'].includes(row.status) || row.status !== 'dispatching' && deliveredAt >= row.expiresAt || deliveredAt < row.createdAt) throw workError('ATTENTION_NOT_PENDING');
      return {
        type: 'attention.sent',
        day,
        reservationId,
        botMessageId: String(botMessageId),
        at: deliveredAt
      };
    });
  }
  fail({
    username,
    reservationId,
    uncertain,
    asOf = this.#clock()
  }) {
    return this.#change(username, reservationId, 'fail', asOf, row => !['prepared', 'dispatching'].includes(row.status) ? null : {
      type: 'attention.failed',
      reservationId,
      uncertain: uncertain === true,
      at: asOf
    });
  }
  respond({
    username,
    reservationId,
    action,
    asOf = this.#clock()
  }) {
    if (!['keep_active', 'snooze', 'retire', 'review', 'later', 'dismiss', 'cancel', 'refresh'].includes(action)) throw workError('INVALID_ATTENTION_RESPONSE');
    return this.#change(username, reservationId, 'respond', asOf, row => {
      if (row.response) {
        if (row.response.action !== action) throw workError('ATTENTION_RESPONSE_CONFLICT');
        return null;
      }
      if (row.status !== 'delivered') throw workError('ATTENTION_NOT_DELIVERED');
      return {
        type: 'attention.responded',
        reservationId,
        action,
        at: asOf
      };
    });
  }
}
