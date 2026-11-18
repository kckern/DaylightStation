import { createHash } from 'node:crypto';
import { keyOf, validateWorkItem, validateWorkRef } from './workModel.mjs';
export const workError = code => Object.assign(new Error(code), {
  code
});
export function assertWorkUser(username) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username)) throw workError('INVALID_WORK_USER');
}
export const stableWorkJson = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const workHash = value => createHash('sha256').update(stableWorkJson(value)).digest('hex');
export const workRelevanceVersion = r => workHash({
  state: r?.state ?? 'unconfirmed',
  confirmedAt: r?.confirmedAt ?? null,
  reviewAt: r?.reviewAt ?? null,
  snoozedUntil: r?.snoozedUntil ?? null,
  invitationUntil: r?.invitationUntil ?? null
});
export const accountKey = ({
  provider,
  accountId
}) => JSON.stringify([provider, accountId]);
export function emptyWorkState() {
  return {
    links: {},
    relevance: {},
    snapshots: {},
    commands: {},
    activities: {},
    decisions: {},
    baselines: {},
    calls: {},
    sources: {},
    attention: {},
    reviewPreferences: {},
    offers: {}
  };
}
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const instant = value => value === null || finite(value);
export function applyWorkEvents(before, events, {
  username
}) {
  const state = structuredClone(before);
  if (!Array.isArray(events) || events.length < 1 || events.length > 1000) throw workError('INVALID_WORK_EVENT');
  for (const event of events) {
    if (!event || typeof event.type !== 'string') throw workError('INVALID_WORK_EVENT');
    if (event.type === 'workflow.link_candidate') {
      const r = state.offers?.[event.offerId],
        c = event.candidate;
      if (!r || r.offer.flowType !== 'create_link' || r.status === 'resolved' || !finite(event.at) || !c || !/^loop\.[a-z0-9][a-z0-9-]{0,95}$/.test(c.id ?? '') || typeof c.title !== 'string' || c.title.length > 2000 || !Array.isArray(c.basisRefs) || !c.basisRefs.length || c.basisRefs.length > 5 || c.basisRefs.some(ref => typeof ref !== 'string' || !ref || ref.length > 2048) || typeof c.revision !== 'string' || c.revision.length > 256 || !Number.isSafeInteger(c.cursor) || c.cursor < 0) throw workError('INVALID_WORKFLOW_LINK');
      r.linkCandidate = structuredClone(c);
    } else if (['workflow.prepared', 'workflow.responded'].includes(event.type)) {
      const r = state.offers?.[event.offerId];
      if (!r || !finite(event.at)) throw workError('INVALID_WORKFLOW_EVENT');
      if (event.type === 'workflow.prepared') {
        if (r.status !== 'selected' || r.decisionId || typeof event.decisionId !== 'string' || typeof event.reservationId !== 'string') throw workError('INVALID_WORKFLOW_EVENT');
        r.status = 'prepared';
        r.decisionId = event.decisionId;
        r.reservationId = event.reservationId;
      } else {
        if (r.status === 'resolved' || !['review', 'later', 'dismiss', 'keep_active', 'snooze', 'retire', 'refresh', 'link'].includes(event.action)) throw workError('INVALID_WORKFLOW_EVENT');
        r.status = event.resolved ? 'resolved' : 'processing';
        r.response = {
          action: event.action,
          at: event.at
        };
        if (r.offer.flowType === 'knowledge_review' && ['later', 'dismiss'].includes(event.action)) {
          if (event.action === 'later' && (!finite(event.reviewUntil) || event.reviewUntil <= event.at || event.reviewUntil > event.at + 31 * 86400000)) throw workError('INVALID_WORKFLOW_EVENT');
          state.reviewPreferences ??= {};
          for (const id of r.offer.evidenceRefs) state.reviewPreferences[id] = {
            state: event.action === 'dismiss' ? 'dismissed' : 'snoozed',
            until: event.reviewUntil ?? null,
            at: event.at
          };
        }
      }
    } else if (event.type === 'workflow.selected') {
      const r = event.record,
        o = r?.offer;
      if (!o || o.username !== username || !/^offer\.[a-f0-9]{64}$/.test(o.id ?? '') || !['reconcile', 'reactivate', 'housekeeping', 'wrap_up', 'coverage_repair', 'create_link', 'knowledge_review'].includes(o.flowType) || typeof o.domainId !== 'string' || typeof o.policyRevision !== 'string' || !finite(o.eligibleAt) || !finite(o.expiresAt) || o.questionUnits !== 1 || !Array.isArray(o.evidenceRefs) || o.evidenceRefs.length > 5 || o.evidenceRefs.some(ref => typeof ref !== 'string' || !ref || ref.length > 2048) || o.requiresConfirmation !== true || o.expectedVersion !== null && (typeof o.expectedVersion !== 'string' || !o.expectedVersion || o.expectedVersion.length > 256) || o.kbObjectId !== null && typeof o.kbObjectId !== 'string' || typeof o.reason !== 'string' || !o.reason || o.reason.length > 128 || !/^([a-f0-9]{64})$/.test(r.relevanceVersion ?? '') || r.status !== 'selected') throw workError('INVALID_WORKFLOW_OFFER');
      if (o.ref !== null) validateWorkRef(o.ref);
      state.offers ??= {};
      if (state.offers[o.id] && stableWorkJson(state.offers[o.id]) !== stableWorkJson(r)) throw workError('WORKFLOW_OFFER_CONFLICT');
      state.offers[o.id] = structuredClone(r);
    } else if (event.type === 'attention.reserved') {
      const r = event.reservation;
      if (!r || r.username !== username || !/^attention\.[a-f0-9]{64}$/.test(r.id ?? '') || typeof r.decisionId !== 'string' || !r.decisionId || !/^\d{4}-\d{2}-\d{2}$/.test(r.day ?? '') || !['morning', 'housekeeping', 'review', 'direct_request', 'echo', 'quiz'].includes(r.channel) || typeof r.flowType !== 'string' || !Number.isInteger(r.questionUnits) || r.questionUnits < 1 || r.questionUnits > 5 || !finite(r.createdAt) || !finite(r.expiresAt) || r.expiresAt <= r.createdAt || r.expiresAt > r.createdAt + 86400000 || r.status !== 'prepared' || r.deliveredAt !== null || r.botMessageId !== null || r.response !== null) throw workError('INVALID_ATTENTION_EVENT');
      state.attention ??= {};
      if (state.attention[r.id] && stableWorkJson(state.attention[r.id]) !== stableWorkJson(r)) throw workError('ATTENTION_CONFLICT');
      state.attention[r.id] = structuredClone(r);
    } else if (['attention.dispatching', 'attention.sent', 'attention.failed', 'attention.responded'].includes(event.type)) {
      const r = state.attention?.[event.reservationId];
      if (!r || !finite(event.at)) throw workError('INVALID_ATTENTION_EVENT');
      if (event.type === 'attention.dispatching') {
        if (r.status !== 'prepared' || event.at >= r.expiresAt) throw workError('INVALID_ATTENTION_EVENT');
        r.status = 'dispatching';
        r.dispatchedAt = event.at;
      } else if (event.type === 'attention.sent') {
        if (!['prepared', 'dispatching'].includes(r.status) || !/^\d+$/.test(event.botMessageId ?? '') || event.at < r.createdAt || r.status !== 'dispatching' && event.at >= r.expiresAt) throw workError('INVALID_ATTENTION_EVENT');
        r.status = 'delivered';
        if (event.day !== undefined) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(event.day)) throw workError('INVALID_ATTENTION_EVENT');
          r.reservedDay = r.day;
          r.day = event.day;
        }
        r.deliveredAt = event.at;
        r.botMessageId = event.botMessageId;
      } else if (event.type === 'attention.failed') {
        if (!['prepared', 'dispatching'].includes(r.status) || typeof event.uncertain !== 'boolean') throw workError('INVALID_ATTENTION_EVENT');
        r.status = event.uncertain ? 'quarantined' : 'cancelled';
        r.failedAt = event.at;
      } else {
        if (r.status !== 'delivered' || r.response || !['keep_active', 'snooze', 'retire', 'review', 'later', 'dismiss', 'cancel', 'refresh'].includes(event.action)) throw workError('INVALID_ATTENTION_EVENT');
        r.response = {
          action: event.action,
          at: event.at
        };
      }
    } else if (event.type === 'relevance.changed') {
      validateWorkRef(event.ref);
      const r = event.relevance,
        key = keyOf(event.ref);
      if (!r || r.key !== key || !['unconfirmed', 'active', 'paused', 'retired'].includes(r.state) || !['confirmedAt', 'reviewAt', 'snoozedUntil', 'lastOfferedAt'].every(k => instant(r[k])) || !Number.isSafeInteger(r.ignoredOffers) || r.ignoredOffers < 0 || Object.hasOwn(r, 'invitationUntil') && !instant(r.invitationUntil)) throw workError('INVALID_WORK_EVENT');
      state.relevance[key] = structuredClone(r);
    } else if (event.type === 'snapshot.observed') {
      const s = event.snapshot,
        key = accountKey(event),
        old = state.snapshots[key];
      validateWorkRef({
        provider: event.provider,
        accountId: event.accountId,
        kind: 'container',
        id: 'validation'
      });
      if (!s || !finite(s.observedAt) || !Array.isArray(s.items) || !Array.isArray(s.containers) || !Array.isArray(s.events) || typeof s.coverage?.complete !== 'boolean' || typeof s.revision !== 'string') throw workError('INVALID_WORK_EVENT');
      for (const item of s.items) {
        validateWorkItem(item);
        if (item.ref.provider !== event.provider || item.ref.accountId !== event.accountId) throw workError('INVALID_WORK_EVENT');
      }
      if (old && s.observedAt < old.observedAt) continue;
      if (old && s.observedAt === old.observedAt && s.revision !== old.revision) throw workError('WORK_SNAPSHOT_CONFLICT');
      state.snapshots[key] = structuredClone(s);
    } else if (event.type === 'link.confirmed') {
      const link = event.link;
      if (!link || link.username !== username || typeof link.id !== 'string' || !/^link\.[a-f0-9]{64}$/.test(link.id) || !/^(loop|person)\.[a-z0-9][a-z0-9-]{0,95}$/.test(link.kbObjectId) || !['action_for', 'same_commitment', 'context_for'].includes(link.relation) || !Array.isArray(link.basisRefs) || link.basisRefs.some(ref => typeof ref !== 'string' || !ref || ref.length > 2048) || !finite(link.confirmedAt)) throw workError('INVALID_WORK_EVENT');
      validateWorkRef(link.workRef);
      const old = state.links[link.id];
      if (old && stableWorkJson(old) !== stableWorkJson(link)) throw workError('WORK_LINK_CONFLICT');
      state.links[link.id] = structuredClone(link);
    } else if (event.type === 'command.queued') {
      const r = event.record,
        c = r?.command;
      if (!c || c.username !== username || typeof c.id !== 'string' || !/^command\.[a-f0-9]{64}$/.test(c.id) || r.status !== 'queued' || typeof r.requiresConfirmation !== 'boolean' || typeof r.policyRevision !== 'string' || !r.policyRevision || typeof c.expectedVersion !== 'string' || !c.expectedVersion || typeof c.sourceReceipt !== 'string' || !c.sourceReceipt || !finite(c.createdAt) || !['complete', 'reopen', 'transition', 'create_task', 'update_task', 'archive_task', 'delete_task', 'create_container', 'rename_container', 'archive_container'].includes(c.operation) || !c.payload || typeof c.payload !== 'object' || Array.isArray(c.payload) || typeof c.domainId !== 'string' || !c.domainId) throw workError('INVALID_WORK_EVENT');
      if (c.ref !== null) validateWorkRef(c.ref);
      if (state.commands[c.id] && stableWorkJson(state.commands[c.id]) !== stableWorkJson(r)) throw workError('WORK_COMMAND_CONFLICT');
      state.commands[c.id] = structuredClone(r);
    } else if (event.type === 'command.dispatched') {
      const r = state.commands[event.commandId];
      if (!r || r.status !== 'queued' || !finite(event.at) || r.requiresConfirmation && (typeof event.confirmationId !== 'string' || !event.confirmationId)) throw workError('INVALID_WORK_COMMAND_TRANSITION');
      r.command.confirmationId = event.confirmationId ?? null;
      r.status = 'dispatching';
      r.dispatchedAt = event.at;
    } else if (event.type === 'command.quarantined') {
      const r = state.commands[event.commandId];
      if (!r || r.status !== 'dispatching' || !finite(event.at)) throw workError('INVALID_WORK_COMMAND_TRANSITION');
      r.status = 'uncertain';
      r.result = {
        outcome: 'uncertain',
        ref: r.command.ref,
        item: null,
        observation: null,
        reason: 'recovery_required',
        retryAfter: null
      };
    } else if (event.type === 'command.finished') {
      const r = state.commands[event.commandId],
        result = event.result;
      if (!r || !['dispatching', 'uncertain'].includes(r.status) || !result || !['applied', 'already_applied', 'uncertain', 'conflict', 'denied', 'failed'].includes(result.outcome) || result.ref !== null && !result.ref || result.item !== null && !result.item || result.reason !== null && typeof result.reason !== 'string' || result.retryAfter !== null && !finite(result.retryAfter)) throw workError('INVALID_WORK_COMMAND_TRANSITION');
      if (result.ref !== null) validateWorkRef(result.ref);
      if (result.item !== null) validateWorkItem(result.item);
      r.status = result.outcome === 'already_applied' ? 'applied' : result.outcome;
      r.result = structuredClone(result);
      if (event.reconciledAt !== undefined) {
        if (!finite(event.reconciledAt)) throw workError('INVALID_WORK_EVENT');
        r.lastReconciledAt = Math.max(r.lastReconciledAt ?? 0, event.reconciledAt);
      }
    } else if (event.type === 'activity.observed') {
      const a = event.event;
      if (!a || a.username !== username || typeof a.id !== 'string' || !a.id.startsWith('work:') || !['created', 'updated', 'completed', 'reopened', 'archived', 'deleted'].includes(a.type) || !finite(a.occurredAt) || !finite(a.observedAt) || a.occurredAt > a.observedAt || a.occurredAtEstimated === true || typeof a.occurrenceId !== 'string' || !a.occurrenceId || !Array.isArray(a.sourceRefs)) throw workError('INVALID_WORK_EVENT');
      validateWorkRef(a.ref);
      validateWorkRef(a.containerRef);
      const old = state.activities[a.id];
      if (old) {
        const stable = x => {
          const {
            observedAt,
            ...rest
          } = x;
          return rest;
        };
        if (stableWorkJson(stable(old.event)) !== stableWorkJson(stable(a))) throw workError('WORK_ACTIVITY_CONFLICT');
      } else state.activities[a.id] = {
        event: structuredClone(a),
        projected: false,
        knowledgeApplied: false
      };
    } else if (['activity.projected', 'activity.knowledge_applied'].includes(event.type)) {
      const activity = state.activities[event.eventId];
      if (!activity || !finite(event.at) || event.type === 'activity.knowledge_applied' && !activity.projected) throw workError('INVALID_WORK_EVENT');
      activity[event.type === 'activity.projected' ? 'projected' : 'knowledgeApplied'] = true;
    } else if (event.type === 'observation.baseline') {
      const key = accountKey(event);
      validateWorkRef({
        provider: event.provider,
        accountId: event.accountId,
        kind: 'container',
        id: 'validation'
      });
      if (!finite(event.at) || state.baselines[key]) throw workError('INVALID_WORK_EVENT');
      state.baselines[key] = {
        at: event.at
      };
    } else if (event.type === 'call.reserved') {
      const call = event.call;
      if (!call || call.username !== username || typeof call.id !== 'string' || !/^call\.[a-f0-9]{64}$/.test(call.id) || !['knowledge-extraction', 'journal-intent', 'workflow-rank'].includes(call.scope) || !/^\d{4}-\d{2}-\d{2}$/.test(call.day ?? '') || !finite(call.at)) throw workError('INVALID_WORK_EVENT');
      if (state.calls[call.id]) throw workError('WORK_CALL_ALREADY_RESERVED');
      state.calls[call.id] = structuredClone(call);
    } else if (event.type === 'decision.prepared') {
      const d = event.decision;
      if (!d || d.username !== username || typeof d.id !== 'string' || !d.id.startsWith('decision.') || state.decisions[d.id] || d.status !== 'prepared' || typeof d.senderId !== 'string' || typeof d.conversationId !== 'string' || typeof d.policyRevision !== 'string' || !finite(d.createdAt) || !finite(d.expiresAt) || d.expiresAt - d.createdAt > 86400000 || d.expiresAt <= d.createdAt || !Array.isArray(d.choices) || d.choices.length < 1 || d.choices.length > 6 || d.choices.some(c => !/^([a-f0-9]{64})$/.test(c.tokenHash ?? '') || !['confirm', 'cancel', 'choose', 'next', 'back', 'none'].includes(c.action) || Object.hasOwn(c, 'callback_data'))) throw workError('INVALID_WORK_EVENT');
      state.decisions[d.id] = structuredClone(d);
    } else if (event.type === 'decision.delivered') {
      const d = state.decisions[event.decisionId];
      if (!d || d.status !== 'prepared' || !finite(event.at) || typeof event.botMessageId !== 'string' || !/^[1-9][0-9]*$/.test(event.botMessageId)) throw workError('INVALID_WORK_EVENT');
      d.status = 'delivered';
      d.botMessageId = event.botMessageId;
      d.deliveredAt = event.at;
    } else if (event.type === 'decision.failed') {
      const d = state.decisions[event.decisionId];
      if (!d || !['prepared', 'delivered', 'uncertain', 'failed'].includes(d.status) || !finite(event.at)) throw workError('INVALID_WORK_EVENT');
      d.status = event.uncertain ? 'uncertain' : 'failed';
    } else if (event.type === 'decision.claimed') {
      const d = state.decisions[event.decisionId];
      if (!d || d.status !== 'delivered' || !d.choices.some(c => c.tokenHash === event.tokenHash) || !finite(event.at)) throw workError('INVALID_WORK_EVENT');
      d.status = 'claimed';
      d.claimed = {
        tokenHash: event.tokenHash,
        at: event.at
      };
    } else if (event.type === 'decision.resolved') {
      const d = state.decisions[event.decisionId];
      if (!d || d.status !== 'claimed' || !event.result || typeof event.result.status !== 'string' || !finite(event.at)) throw workError('INVALID_WORK_EVENT');
      d.status = 'resolved';
      d.result = structuredClone(event.result);
    } else if (event.type === 'source.observed') {
      const source = event.source;
      if (!source || source.username !== username || !/^source\.[a-f0-9]{64}$/.test(source.id ?? '') || !['journal', 'interactive'].includes(source.kind) || typeof source.authRevision !== 'string' || typeof source.senderId !== 'string' || typeof source.conversationId !== 'string' || typeof source.messageId !== 'string' || !finite(source.at) || !finite(source.observedAt) || !finite(source.deadline) || source.deadline < source.observedAt || !Array.isArray(source.intents) || typeof source.valid !== 'boolean' || !['pending', 'processed'].includes(source.status) || source.kind === 'journal' && (typeof source.ref !== 'string' || !/^journalist:msg:[a-f0-9]{64}$/.test(source.ref) || !/^([a-f0-9]{64})$/.test(source.sourceHash ?? ''))) throw workError('INVALID_WORK_EVENT');
      if (state.sources[source.id]) throw workError('WORK_SOURCE_CONFLICT');
      if (source.kind === 'journal') for (const old of Object.values(state.sources)) if (old.kind === 'journal' && old.conversationId === source.conversationId && old.messageId === source.messageId && old.valid) {
        old.valid = false;
        old.status = 'invalidated';
        for (const record of Object.values(state.commands)) if (record.command.sourceReceipt === old.id) {
          if (record.status === 'queued') {
            record.status = 'denied';
            record.result = {
              outcome: 'denied',
              ref: record.command.ref,
              item: null,
              observation: null,
              reason: 'source_superseded',
              retryAfter: null
            };
          } else if (['dispatching', 'uncertain', 'applied'].includes(record.status)) record.reconciliationNeeded = true;
        }
      }
      state.sources[source.id] = {
        ...structuredClone(source),
        ordinal: Object.keys(state.sources).length + 1
      };
      if (source.status === 'pending' && source.deadline > source.observedAt) for (const old of Object.values(state.sources)) if (old.valid && old.status === 'pending') old.deadline = source.deadline;
    } else if (event.type === 'source.interpreted') {
      const source = state.sources[event.sourceId];
      if (!source || !source.valid || !['processed', 'deferred'].includes(event.status) || !Array.isArray(event.intents) || event.intents.length > 5 || !finite(event.at)) throw workError('INVALID_WORK_EVENT');
      source.status = event.status;
      source.intents = structuredClone(event.intents);
      source.reason = event.reason ?? null;
    } else if (event.type === 'recovery.tail') {
      if (!Number.isSafeInteger(event.bytes) || event.bytes < 1 || typeof event.digest !== 'string' || !/^[a-f0-9]{64}$/.test(event.digest)) throw workError('INVALID_WORK_EVENT');
    } else throw workError('INVALID_WORK_EVENT');
  }
  return state;
}
