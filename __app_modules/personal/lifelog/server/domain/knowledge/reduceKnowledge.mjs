/** Applies only quoted proposals. User decisions use a separate explicit entry point. */
import { KNOWLEDGE_SCHEMA, evidenceProblem, proposalProblem, normalizeQuote, newBatch, isPinned } from './contracts.mjs';
import { addDays, localDateFor, resolveDueDate } from './calendar.mjs';

export function reduceKnowledge({ snapshot, proposals, evidence, asOf, timezone, mode = 'commit' }) {
  localDateFor(asOf, timezone);
  if (!['commit','preview'].includes(mode)) throw new TypeError('Invalid reduction mode');
  const batch = newBatch(mode === 'preview');
  const objects = structuredClone(snapshot.objects ?? {});
  const processed = new Set(snapshot.state?.processedProposalIds ?? []);
  const reviews = structuredClone(snapshot.state?.pendingReviews ?? []);
  const changed = new Map(); const rejected = []; const sources = new Map(); const ambiguous = new Set();
  for (const source of evidence ?? []) {
    if (sources.has(source.ref) && JSON.stringify(sources.get(source.ref)) !== JSON.stringify(source)) ambiguous.add(source.ref);
    else sources.set(source.ref, source);
  }
  const event = (p, type, extra = {}) => batch.events.push({ id: p.id + ':' + type, type, at: asOf, objectId: p.target, proposal: structuredClone(p), ...extra });
  const queue = (p, reason) => { if (!reviews.some(r => r.id === p.id)) reviews.push({ id: p.id, reason, proposal: structuredClone(p), createdAt: asOf }); event(p, 'proposal.queued', { reason }); };
  for (const p of proposals ?? []) {
    if (processed.has(p?.id)) continue;
    const source = sources.get(p?.evidenceRef); const original = objects[p?.target]; const f = p?.fields ?? {};
    let reason = proposalProblem(p) || (ambiguous.has(p.evidenceRef) ? 'ambiguous_evidence' : evidenceProblem(source, { mode, timezone, asOf }));
    if (!reason && !normalizeQuote(source.content).includes(normalizeQuote(p.quote))) reason = 'quote_not_found';
    if (!reason && ['touch','close_loop','alias_candidate'].includes(p.op) && !original) reason = 'unknown_target';
    if (!reason && original && (source.at < original.created.sourceAt || (p.op === 'close_loop' && source.at <= original.created.sourceAt))) reason = 'predates_loop';
    if (!reason && p.op === 'close_loop' && (original.kind !== 'loop' || isPinned(original, 'status') || isPinned(original, 'loop.answer'))) reason = original.kind !== 'loop' ? 'invalid_target' : 'pinned_field';
    if (!reason && p.op === 'open_loop' && f.due && !normalizeQuote(p.quote).includes(f.due) && (!f.dueText || resolveDueDate({text:f.dueText,entryDate:source.localDate,timezone}) !== f.due)) reason = 'due_not_grounded';
    if (!reason && p.op === 'propose_entity' && original && ((f.role && f.role !== original.role && isPinned(original,'role')) || (!(original.names ?? []).includes(f.name) && isPinned(original,'names')) || isPinned(original,'status'))) reason = 'pinned_field';
    if (!reason && p.op === 'alias_candidate' && original && isPinned(original,'aliases')) reason = 'pinned_field';
    if (!reason && p.op === 'open_loop' && original) reason = 'target_exists';
    if (!reason && p.op === 'open_loop' && (f.links ?? []).some(id => !objects[id])) reason = 'unknown_target';
    if (!reason && p.op === 'propose_entity' && !normalizeQuote(p.quote).includes(normalizeQuote(f.name))) reason = 'name_not_quoted';
    if (!reason && p.op === 'alias_candidate' && (original.kind !== 'person' || !normalizeQuote(p.quote).includes(normalizeQuote(f.alias)))) reason = 'alias_not_quoted';
    if (p?.id) processed.add(p.id);
    if (reason) { rejected.push({ proposalId: p?.id, reason }); event(p ?? {}, 'proposal.rejected', { reason }); continue; }
    if (p.op === 'propose_entity' && original && !(original.names ?? []).includes(f.name)) { queue(p, 'ambiguous_person_name'); continue; }
    const sensitivity = f.sensitivity ?? original?.sensitivity ?? 'normal';
    if (p.op === 'open_loop' && (sensitivity !== 'normal' || (f.links ?? []).some(id => objects[id].sensitivity !== 'normal'))) {
      queue({ ...p, fields: { ...f, ask_policy: 'never' } }, 'sensitive'); continue;
    }
    const ref = { ref: source.ref, date: source.localDate, at: source.at, quote: p.quote, source: 'user' };
    const base = { schema: KNOWLEDGE_SCHEMA, id: p.target, kind: p.target.split('.')[0], title: f.title ?? f.name,
      created: { at: asOf, sourceAt: source.at, by: 'extractor@v1' }, touched: source.localDate, links: f.links ?? [], pinned: [], user_edits: [], sensitivity,
      ask_policy: sensitivity === 'normal' ? (f.ask_policy ?? 'normal') : 'never', evidence: [] };
    const object = original ? structuredClone(original) : base;
    if (!object.evidence.some(e => e.ref === ref.ref && normalizeQuote(e.quote) === normalizeQuote(ref.quote))) object.evidence.push(ref);
    object.touched = [object.touched, source.localDate].sort().at(-1);
    if (p.op === 'open_loop') {
      const due = f.due ?? (f.dueText ? resolveDueDate({ text: f.dueText, entryDate: source.localDate, timezone }) : null);
      object.status = f.waiting || (due && due >= localDateFor(asOf, timezone)) ? 'waiting' : 'open';
      object.loop = { kind_of: f.kind_of ?? 'status', due, due_basis: f.dueText ?? f.due ?? null, stakes: f.stakes ?? 1,
        ask: { eligible_from: due ? addDays(due, 1) : addDays(source.localDate, 1), cooldown_days: 7, max_asks: 2 }, answer: null };
      if (f.dueText && !due) queue(p, 'unsupported_due_text');
    } else if (p.op === 'close_loop') {
      object.status = f.status;
      if(!isPinned(object,'closedOn'))object.closedOn=['answered','dropped'].includes(f.status)?localDateFor(asOf,timezone):null;
      object.loop.answer = { at: asOf, by: 'text', result: f.answer && normalizeQuote(p.quote).includes(normalizeQuote(f.answer)) ? f.answer : p.quote, evidence: [ref] };
    } else if (p.op === 'touch' && object.kind === 'loop' && object.status === 'stale' && !isPinned(object, 'status')) {
      object.status = 'open';if(!isPinned(object,'closedOn'))object.closedOn=null;object.loop.ask.reopenedAt = asOf;
    } else if (p.op === 'propose_entity') {
      object.names = [...new Set([...(object.names ?? []), f.name])]; object.aliases ??= [];
      object.status = new Set(object.evidence.filter(e => !e.retracted).map(e => e.date)).size >= 2 ? 'active' : 'candidate';
      if (f.role && normalizeQuote(p.quote).includes(normalizeQuote(f.role))) object.role = f.role;
      if (object.status === 'candidate') queue(p, 'person_confirmation');
    } else if (p.op === 'alias_candidate') {
      const aliases = object.aliases ?? []; const existing = aliases.find(a => a.value === f.alias);
      const dates = [...new Set([...(existing?.dates ?? []), source.localDate])];
      const alias = { value: f.alias, confirmed: existing?.confirmed === true || dates.length >= 2, dates };
      object.aliases = [...aliases.filter(a => a.value !== f.alias), alias];
      if (!alias.confirmed) queue(p, 'alias_confirmation');
    }
    objects[object.id] = object; changed.set(object.id, object); event(p, 'proposal.accepted');
  }
  batch.upserts = [...changed.values()]; batch.statePatch = { processedProposalIds: [...processed], pendingReviews: reviews };
  return { batch, rejected };
}

/** Authority and delivered-token binding are checked by the application before this pure transition. */
export function applyUserReply({ object, action, receiptId, asOf, timezone }) {
  const today = localDateFor(asOf,timezone);
  if (object?.kind !== 'loop' || !['yes','not_yet','drop','skip'].includes(action) || typeof receiptId !== 'string' || !receiptId) throw new TypeError('Invalid user decision');
  if ((object.loop.appliedReceiptIds ?? []).includes(receiptId)) return structuredClone(object);
  const next = structuredClone(object); const before = next.status;
  next.loop.appliedReceiptIds = [...(next.loop.appliedReceiptIds ?? []),receiptId];
  if (action === 'skip') {
    next.loop.ask.skip_count = (next.loop.ask.skip_count ?? 0) + 1;
    next.loop.ask.deferred_until = addDays(today,3);
    if (next.loop.ask.skip_count >= 2) next.status = 'stale';
  } else {
    next.status = {yes:'answered',not_yet:'waiting',drop:'dropped'}[action];
    next.loop.answer = {at:asOf,by:'tap',result:action,receiptId};
    if (action === 'not_yet') next.loop.ask.eligible_from = addDays(today,Math.max(3,next.loop.ask.cooldown_days ?? 7));
  }
  next.closedOn=['answered','dropped','stale'].includes(next.status)?today:null;
  next.user_edits.push({path:'status',before,after:next.status,at:asOf,by:'tap',receiptId});
  next.user_edits.push({path:'loop',before:structuredClone(object.loop),after:structuredClone(next.loop),at:asOf,by:'tap',receiptId});
  if(object.closedOn!==next.closedOn)next.user_edits.push({path:'closedOn',before:object.closedOn??null,after:next.closedOn,at:asOf,by:'tap',receiptId});
  return next;
}
