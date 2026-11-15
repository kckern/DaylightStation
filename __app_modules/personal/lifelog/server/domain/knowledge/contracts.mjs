/** Phase-one knowledge contracts. Validation is independent of persistence and AI. */
import { isLocalDate, localDateFor } from './calendar.mjs';
export const KNOWLEDGE_SCHEMA = 'lifelog-knowledge/v1';
export const OBJECT_ID = /^(loop|person)\.[a-z0-9][a-z0-9-]{0,95}$/;
export const LOOP_STATUSES = Object.freeze(['open','waiting','answered','stale','dropped']);
export const ASK_POLICIES = Object.freeze(['normal','never','user_initiated','data_only']);
export const SENSITIVITIES = Object.freeze(['normal','private','child','financial']);
export const REPLY_WINDOW_MS = 36 * 60 * 60 * 1000;
export const normalizeQuote = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
export const objectsOf = snapshot => Object.values(snapshot.objects ?? {});
export const isPinned = (object, field) => (object.pinned ?? []).some(p => p === field || field.startsWith(p + '.') || p.startsWith(field + '.'));
export function emptySnapshot() {
  return { revision: 0, objects: {}, asks: [], quiz: [], state: { processedProposalIds: [], pendingReviews: [], manifest: {} }, health: { available: true, conflicted: false, recovering: false, lastSweepAt: null, reason: null } };
}
export function newBatch(previewOnly = false) { return { events: [], upserts: [], moves: [], statePatch: {}, previewOnly }; }
export function validateKnowledgeObject(object) {
  if (object?.schema !== KNOWLEDGE_SCHEMA || !OBJECT_ID.test(object.id ?? '') || !object.id.startsWith(object.kind + '.')) throw new TypeError('Invalid knowledge object identity or schema');
  if (typeof object.title !== 'string' || !object.title.trim() || object.title.length > 240 || !SENSITIVITIES.includes(object.sensitivity) || !ASK_POLICIES.includes(object.ask_policy)) throw new TypeError('Invalid knowledge object fields');
  if (!(object.kind === 'loop' ? LOOP_STATUSES : ['candidate','active']).includes(object.status)) throw new TypeError('Invalid knowledge status');
  if (!Number.isFinite(object.created?.sourceAt) || !isLocalDate(object.touched) || !Array.isArray(object.evidence) || !Array.isArray(object.pinned) || !Array.isArray(object.user_edits)) throw new TypeError('Invalid knowledge provenance');
  if (object.evidence.some(e => typeof e.ref !== 'string' || !normalizeQuote(e.quote) || !isLocalDate(e.date))) throw new TypeError('Invalid knowledge evidence');
  if (object.kind === 'loop' && (!object.loop || !['status','outcome','confirm','identity','detail','lookup'].includes(object.loop.kind_of) || (object.loop.due != null && !isLocalDate(object.loop.due)))) throw new TypeError('Invalid loop policy');
  return object;
}
export function evidenceProblem(evidence, { mode, timezone, asOf }) {
  if (!evidence || evidence.source !== 'user' || evidence.senderMatchesConfiguredUser !== true || (mode !== 'preview' && (evidence.verified !== true || evidence.previewOnly === true))) return 'unverified_evidence';
  if (typeof evidence.sourceId !== 'string' || evidence.ref !== 'journalist:msg:' + evidence.sourceId || !evidence.conversationId || !evidence.messageId || !evidence.senderId || typeof evidence.content !== 'string' || !Number.isFinite(evidence.at) || evidence.at > asOf || evidence.localDate !== localDateFor(evidence.at, timezone)) return 'invalid_evidence';
  return null;
}
const FIELDS = {
  open_loop: ['title','kind_of','dueText','due','stakes','sensitivity','ask_policy','links','waiting'],
  touch: [], close_loop: ['status','answer'],
  propose_entity: ['kind','name','role','sensitivity'], alias_candidate: ['alias'],
};
export function proposalProblem(proposal) {
  if (!Object.hasOwn(FIELDS, proposal?.op)) return 'unsupported_operation';
  if (proposal.op === 'propose_entity' && proposal.fields?.kind !== 'person') return 'unsupported_phase1_kind';
  if (typeof proposal.id !== 'string' || !proposal.id || !OBJECT_ID.test(proposal.target ?? '') || typeof proposal.evidenceRef !== 'string' || !normalizeQuote(proposal.quote)) return 'invalid_proposal';
  if (!proposal.fields || typeof proposal.fields !== 'object' || Array.isArray(proposal.fields) || Object.keys(proposal.fields).some(k => !FIELDS[proposal.op].includes(k))) return 'unsupported_fields';
  const f = proposal.fields;
  if (proposal.op === 'open_loop' && (!proposal.target.startsWith('loop.') || typeof f.title !== 'string' || !f.title.trim() || f.title.length > 240 || (f.kind_of != null && !['status','outcome','confirm'].includes(f.kind_of)) || (f.stakes != null && (!Number.isInteger(f.stakes) || f.stakes < 1 || f.stakes > 3)) || (f.sensitivity != null && !SENSITIVITIES.includes(f.sensitivity)) || (f.ask_policy != null && !ASK_POLICIES.includes(f.ask_policy)) || (f.due != null && !isLocalDate(f.due)) || (f.links != null && (!Array.isArray(f.links) || f.links.some(id => typeof id !== 'string'))))) return 'invalid_fields';
  if (proposal.op === 'close_loop' && !['answered','dropped','waiting'].includes(f.status)) return 'invalid_fields';
  if (proposal.op === 'propose_entity' && (!proposal.target.startsWith('person.') || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 180 || (f.sensitivity != null && !SENSITIVITIES.includes(f.sensitivity)))) return 'invalid_fields';
  if (proposal.op === 'alias_candidate' && (typeof f.alias !== 'string' || !f.alias.trim() || f.alias.length > 180)) return 'invalid_fields';
  return null;
}
