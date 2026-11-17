/** Pure aging of acknowledged asks and user-opened loops. */
import { newBatch, objectsOf, isPinned, REPLY_WINDOW_MS } from './contracts.mjs';
import { addDays, daysBetween, localDateFor } from './calendar.mjs';
export function deliveredAsks(snapshot) {
  const unique = new Map();
  for (const a of snapshot.asks ?? []) {
    if (!Number.isFinite(a.deliveredAt) || !a.botMessageId || a.arm === 'legacy') continue;
    const key = [a.objectId, a.botMessageId, a.channel].join('|');
    if (!unique.has(key) || a.response) unique.set(key, a);
  }
  return [...unique.values()];
}
export function unansweredAsks(snapshot, objectId, asOf, reopenedAt = null) {
  return deliveredAsks(snapshot).filter(a => a.objectId === objectId && !a.response && asOf - a.deliveredAt >= REPLY_WINDOW_MS && (reopenedAt == null || a.deliveredAt > reopenedAt));
}
export function sweepKnowledge({ snapshot, asOf, timezone }) {
  const today = localDateFor(asOf, timezone); const batch = newBatch(); const asks = deliveredAsks(snapshot);
  for (const original of objectsOf(snapshot)) {
    if (original.kind !== 'loop' || !['open','waiting'].includes(original.status)) continue;
    const object = structuredClone(original);
    const mine = asks.filter(a => a.objectId === object.id && (object.loop.ask?.reopenedAt == null || a.deliveredAt > object.loop.ask.reopenedAt));
    const skips = mine.filter(a => a.response?.action === 'skip');
    const lastSkip = skips.map(a => a.response.at).filter(Number.isFinite).sort((a,b) => b-a)[0];
    const lastEvidenceDay = [object.loop.due, object.touched].filter(Boolean).sort().at(-1);
    const old = object.loop.due && daysBetween(lastEvidenceDay, today) >= 60;
    const ignored = unansweredAsks(snapshot, object.id, asOf, object.loop.ask?.reopenedAt).length;
    if ((old || ignored >= (object.loop.ask?.max_asks ?? 2) || skips.length >= 2) && !isPinned(object, 'status')) object.status = 'stale';
    if (Number.isFinite(lastSkip) && !isPinned(object, 'loop.ask.deferred_until')) object.loop.ask.deferred_until = addDays(localDateFor(lastSkip, timezone), 3);
    if (JSON.stringify(original) !== JSON.stringify(object)) {
      batch.upserts.push(object); batch.events.push({ id: 'sweep:' + object.id + ':' + today + ':' + object.status, type: 'knowledge.loop.' + object.status, at: asOf, objectId: object.id });
      if (object.status === 'stale' && !isPinned(object,'closedOn'))object.closedOn=today;
      if (object.status === 'stale') batch.moves.push({ id: object.id, closedYear: today.slice(0,4) });
    }
  }
  const messageReplyTimes=Object.values(snapshot.state?.messageReplies??{}).filter(reply=>reply.arm==='knowledge'&&reply.channel==='morning'&&Number.isFinite(reply.at)&&reply.at<=asOf&&['reply_to','window'].includes(reply.attribution)&&asks.some(ask=>ask.channel==='morning'&&ask.botMessageId===reply.botMessageId&&ask.deliveredAt<=reply.at)).map(reply=>reply.at);
  const replyAt = Math.max(0,...messageReplyTimes, ...asks.filter(a => a.response && ['yes','not_yet','drop','text'].includes(a.response.action)).map(a => a.response.at ?? 0));
  const previous = snapshot.state?.backoff ?? null;
  const mornings = new Map();
  for (const a of asks.filter(a => a.channel === 'morning' && a.deliveredAt > replyAt && asOf - a.deliveredAt >= REPLY_WINDOW_MS)) {
    const group = mornings.get(a.askDate) ?? []; group.push(a); mornings.set(a.askDate, group);
  }
  const ignoredDates = [...mornings.keys()].filter(Boolean).sort(); const through = ignoredDates.at(-1);
  let backoff = previous && previous.until > today ? previous : null;
  if (previous && replyAt >= (previous.startedAt ?? 0)) backoff = null;
  if (!backoff && ignoredDates.length >= 3 && through > (snapshot.state?.backoffTriggeredThrough ?? '')) {
    backoff = { since: today, until: addDays(today,14), startedAt: asOf, throughAskDate: through };
    batch.statePatch.backoffTriggeredThrough = through;
  }
  batch.statePatch.backoff = backoff;
  return batch;
}
