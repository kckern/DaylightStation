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
    sources: {}
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
    if (event.type === 'relevance.changed') {
      validateWorkRef(event.ref);
      const r = event.relevance,
        key = keyOf(event.ref);
      if (!r || r.key !== key || !['unconfirmed', 'active', 'paused', 'retired'].includes(r.state) || !['confirmedAt', 'reviewAt', 'snoozedUntil', 'lastOfferedAt'].every(k => instant(r[k])) || !Number.isSafeInteger(r.ignoredOffers) || r.ignoredOffers < 0) throw workError('INVALID_WORK_EVENT');
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
    } else if(event.type==='call.reserved'){
      const call=event.call;if(!call||call.username!==username||typeof call.id!=='string'||!/^call\.[a-f0-9]{64}$/.test(call.id)||!['knowledge-extraction','journal-intent','workflow-rank'].includes(call.scope)||!/^\d{4}-\d{2}-\d{2}$/.test(call.day??'')||!finite(call.at))throw workError('INVALID_WORK_EVENT');if(state.calls[call.id])throw workError('WORK_CALL_ALREADY_RESERVED');state.calls[call.id]=structuredClone(call);
    } else if(event.type==='decision.prepared'){
      const d=event.decision;if(!d||d.username!==username||typeof d.id!=='string'||!d.id.startsWith('decision.')||state.decisions[d.id]||d.status!=='prepared'||typeof d.senderId!=='string'||typeof d.conversationId!=='string'||typeof d.policyRevision!=='string'||!finite(d.createdAt)||!finite(d.expiresAt)||d.expiresAt-d.createdAt>86400000||d.expiresAt<=d.createdAt||!Array.isArray(d.choices)||d.choices.length<1||d.choices.length>6||d.choices.some(c=>!/^([a-f0-9]{64})$/.test(c.tokenHash??'')||!['confirm','cancel','choose','next','back','none'].includes(c.action)||Object.hasOwn(c,'callback_data')))throw workError('INVALID_WORK_EVENT');state.decisions[d.id]=structuredClone(d);
    } else if(event.type==='decision.delivered'){
      const d=state.decisions[event.decisionId];if(!d||d.status!=='prepared'||!finite(event.at)||typeof event.botMessageId!=='string'||!/^[1-9][0-9]*$/.test(event.botMessageId))throw workError('INVALID_WORK_EVENT');d.status='delivered';d.botMessageId=event.botMessageId;d.deliveredAt=event.at;
    } else if(event.type==='decision.failed'){
      const d=state.decisions[event.decisionId];if(!d||!['prepared','delivered','uncertain','failed'].includes(d.status)||!finite(event.at))throw workError('INVALID_WORK_EVENT');d.status=event.uncertain?'uncertain':'failed';
    } else if(event.type==='decision.claimed'){
      const d=state.decisions[event.decisionId];if(!d||d.status!=='delivered'||!d.choices.some(c=>c.tokenHash===event.tokenHash)||!finite(event.at))throw workError('INVALID_WORK_EVENT');d.status='claimed';d.claimed={tokenHash:event.tokenHash,at:event.at};
    } else if(event.type==='decision.resolved'){
      const d=state.decisions[event.decisionId];if(!d||d.status!=='claimed'||!event.result||typeof event.result.status!=='string'||!finite(event.at))throw workError('INVALID_WORK_EVENT');d.status='resolved';d.result=structuredClone(event.result);
    } else if(event.type==='source.observed'){
      const source=event.source;if(!source||source.username!==username||!/^source\.[a-f0-9]{64}$/.test(source.id??'')||!['journal','interactive'].includes(source.kind)||typeof source.authRevision!=='string'||typeof source.senderId!=='string'||typeof source.conversationId!=='string'||typeof source.messageId!=='string'||!finite(source.at)||!finite(source.observedAt)||!finite(source.deadline)||source.deadline<source.observedAt||!Array.isArray(source.intents)||typeof source.valid!=='boolean'||!['pending','processed'].includes(source.status)||source.kind==='journal'&&(typeof source.ref!=='string'||!/^journalist:msg:[a-f0-9]{64}$/.test(source.ref)||!/^([a-f0-9]{64})$/.test(source.sourceHash??'')))throw workError('INVALID_WORK_EVENT');
      if(state.sources[source.id])throw workError('WORK_SOURCE_CONFLICT');
      if(source.kind==='journal')for(const old of Object.values(state.sources))if(old.kind==='journal'&&old.conversationId===source.conversationId&&old.messageId===source.messageId&&old.valid){old.valid=false;old.status='invalidated';for(const record of Object.values(state.commands))if(record.command.sourceReceipt===old.id){if(record.status==='queued'){record.status='denied';record.result={outcome:'denied',ref:record.command.ref,item:null,observation:null,reason:'source_superseded',retryAfter:null};}else if(['dispatching','uncertain','applied'].includes(record.status))record.reconciliationNeeded=true;}}
      state.sources[source.id]={...structuredClone(source),ordinal:Object.keys(state.sources).length+1};
      if(source.status==='pending'&&source.deadline>source.observedAt)for(const old of Object.values(state.sources))if(old.valid&&old.status==='pending')old.deadline=source.deadline;
    } else if(event.type==='source.interpreted'){
      const source=state.sources[event.sourceId];if(!source||!source.valid||!['processed','deferred'].includes(event.status)||!Array.isArray(event.intents)||event.intents.length>5||!finite(event.at))throw workError('INVALID_WORK_EVENT');source.status=event.status;source.intents=structuredClone(event.intents);source.reason=event.reason??null;
    } else if (event.type === 'recovery.tail') {
      if (!Number.isSafeInteger(event.bytes) || event.bytes < 1 || typeof event.digest !== 'string' || !/^[a-f0-9]{64}$/.test(event.digest)) throw workError('INVALID_WORK_EVENT');
    } else throw workError('INVALID_WORK_EVENT');
  }
  return state;
}
