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
    decisions: {}
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
    } else if (event.type === 'recovery.tail') {
      if (!Number.isSafeInteger(event.bytes) || event.bytes < 1 || typeof event.digest !== 'string' || !/^[a-f0-9]{64}$/.test(event.digest)) throw workError('INVALID_WORK_EVENT');
    } else throw workError('INVALID_WORK_EVENT');
  }
  return state;
}
