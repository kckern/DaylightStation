import crypto from 'node:crypto';
import moment from 'moment-timezone';
import { IKnowledgeEvidence } from '../../application/knowledge/ports/IKnowledgeEvidence.mjs';
import { importDigest } from '../../domain/knowledge/importManifest.mjs';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const journalSourceId=(username,conversationId,messageId,revision)=>hash(revision?[username,conversationId,messageId,revision]:[username,conversationId,messageId]);
const MAX_BATCH = 100;
const MAX_MESSAGE_CHARS=20000,MAX_BATCH_CHARS=100000;
const text = value => value == null ? '' : String(value);
export function journalInstant(value, timezone) {
  if (typeof value !== 'string') return NaN;
  if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    return moment.parseZone(value, moment.ISO_8601, true).valueOf();
  }
  return moment.tz(value, ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD h:mm:ss a', 'YYYY-MM-DD h:mm a'], true, timezone).valueOf();
}

/** Reads an immutable receipt projection; never writes, locks or acquires authority. */
export class JournalKnowledgeEvidence extends IKnowledgeEvidence {
  #load; #identity; #timezone; #logger;
  constructor({ loadJournal, identityForUser, timezoneForUser, logger }) {
    super();
    if (typeof loadJournal !== 'function' || typeof identityForUser !== 'function' || typeof timezoneForUser !== 'function') throw new TypeError('Journal evidence requires journal, identity and timezone providers');
    this.#load = loadJournal; this.#identity = identityForUser; this.#timezone = timezoneForUser; this.#logger = logger;
  }

  async #read(username, preview) {
    const identity = await this.#identity(username);
    const timezone = this.#timezone(username);
    if (!identity?.senderId || !identity?.conversationId || !moment.tz.zone(timezone)) throw new Error('Configured private journal identity/timezone unavailable');
    const journal = await this.#load(username);
    if (journal == null) return { messages: [], rejected: [] };
    if (!Array.isArray(journal.messages)) throw new Error('Journal messages are unreadable');
    const known = new Map(), messages = [], rejected = [], revocations=new Set();
    const refuse = (sourceId, reason) => rejected.push({ sourceId, reason });
    for (const row of journal.messages) {
      if (!row || row.role === 'assistant' || text(row.senderId) === 'bot') continue;
      const historicalUser = preview && row.role == null && !row.source;
      if (row.role !== 'user' && !historicalUser) continue;
      const source = row.source;
      const messageId = text(source?.messageId ?? row.id);
      const conversationId = text(source?.conversationId ?? (preview ? identity.conversationId : ''));
      const canonicalId=journalSourceId(username,conversationId,messageId);
      const sourceId = journalSourceId(username,conversationId,messageId,source?.revision);
      if (!messageId || typeof row.content !== 'string' || !row.content.trim()) { refuse(sourceId, 'invalid_evidence'); continue; }
      if (text(row.senderId) !== text(identity.senderId) || (source && (text(source.senderId) !== text(identity.senderId)
        || conversationId !== text(identity.conversationId) || messageId !== text(row.id)))) {
        refuse(sourceId, 'identity_mismatch'); continue;
      }
      if(source?.supersededRevisions){
        if(!Array.isArray(source.supersededRevisions)||source.supersededRevisions.some(version=>version!=='original'&&!/^[a-f0-9]{64}$/.test(version)))throw new Error('Invalid journal revision history');
        for(const revision of source.supersededRevisions)revocations.add('journalist:msg:'+journalSourceId(username,conversationId,messageId,revision==='original'?null:revision));
      }
      const verified = source?.verified === true && source.platform === 'telegram';
      if (source && !verified || !source && !preview) { refuse(sourceId, 'unverified_evidence'); continue; }
      if (verified && source.contentHash !== hash([text(row.id), text(row.senderId), conversationId, row.content, row.timestamp])) {
        refuse(sourceId, 'edited_evidence'); continue;
      }
      if(source?.revision&&(source.edited!==true||!Number.isFinite(source.observedAt)||source.revision!==hash([source.contentHash,source.editDate??null,source.updateId??null,source.observedAt]))){refuse(sourceId,'invalid_revision');continue;}
      const at = journalInstant(row.timestamp, timezone);
      if (!Number.isFinite(at)) { refuse(sourceId, 'invalid_timestamp'); continue; }
      const fingerprint = hash([row.id, row.content, row.timestamp, row.senderId, source ?? null]);
      if (known.has(canonicalId)) {
        if (known.get(canonicalId) !== fingerprint) throw new Error('Conflicting receipts for one journal message identity');
        continue;
      }
      known.set(canonicalId, fingerprint);
      if(row.content.length>MAX_MESSAGE_CHARS){rejected.push({sourceId,reason:'oversized_message',at,observedAt:source?.observedAt??at});continue;}
      messages.push({ ref: `journalist:msg:${sourceId}`, sourceId, conversationId, messageId, at,...(source?.revision?{observedAt:source.observedAt}:{}),
        sourceHash:importDigest([username,{senderId:text(identity.senderId),conversationId:text(identity.conversationId)},timezone,{...row,timestamp:at}]),
        localDate: moment.tz(at, timezone).format('YYYY-MM-DD'), content: row.content,
        senderId: text(row.senderId), verified, previewOnly: !verified,
        senderMatchesConfiguredUser: true, source: 'user' });
    }
    if (rejected.length) this.#logger?.warn?.('lifelog.knowledge.evidence-rejected', { count: rejected.length });
    messages.sort((a,b) => a.at - b.at || a.sourceId.localeCompare(b.sourceId));
    return { messages, rejected,revocations:[...revocations] };
  }

  async readUserMessages({ username, after, through, preview = false }) {
    const lower = typeof after === 'object' && after !== null ? after.since : after;
    const since = typeof lower === 'number' ? lower : Date.parse(lower);
    const until = typeof through === 'number' ? through : Date.parse(through);
    if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) throw new Error('Journal evidence needs an explicit bounded range');
    const seen = new Set(typeof after === 'object' ? after?.seen ?? [] : []);
    const result = await this.#read(username, preview);
    const messages=[],resolved=[];let chars=0,processed=0;
    const candidates=[...result.messages.map(row=>({row,sourceId:row.sourceId,at:row.observedAt??row.at})),...result.rejected.filter(row=>row.reason==='oversized_message').map(row=>({rejection:row,sourceId:row.sourceId,at:row.observedAt??row.at}))]
      .filter(row=>row.at>=since&&row.at<=until&&!seen.has(row.sourceId)).sort((a,b)=>a.at-b.at||a.sourceId.localeCompare(b.sourceId));
    for(const candidate of candidates){
      if(processed>=MAX_BATCH)break;
      if(candidate.row&&chars+candidate.row.content.length>MAX_BATCH_CHARS)break;
      if(candidate.row){messages.push(candidate.row);chars+=candidate.row.content.length;}
      else resolved.push(candidate.rejection);
      seen.add(candidate.sourceId);processed++;
    }
    return { messages, rejected: result.rejected, resolved, cursor: { since, seen: [...seen].sort() } };
  }

  async readRevocations({username}){return (await this.#read(username,false)).revocations??[];}

  async readByRefs({ username, refs, preview = false }) {
    const wanted = new Set(refs);
    return (await this.#read(username, preview)).messages.filter(row => wanted.has(row.ref));
  }
}
