import crypto from 'node:crypto';
import moment from 'moment-timezone';
import { IKnowledgeEvidence } from '../../application/knowledge/ports/IKnowledgeEvidence.mjs';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_BATCH = 100;
const text = value => value == null ? '' : String(value);
function instant(value, timezone) {
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
    const known = new Map(), messages = [], rejected = [];
    const refuse = (sourceId, reason) => rejected.push({ sourceId, reason });
    for (const row of journal.messages) {
      if (!row || row.role !== 'user') continue;
      const source = row.source;
      const messageId = text(source?.messageId ?? row.id);
      const conversationId = text(source?.conversationId ?? (preview ? identity.conversationId : ''));
      const sourceId = hash([username, conversationId, messageId]);
      if (!messageId || typeof row.content !== 'string' || !row.content.trim()) { refuse(sourceId, 'invalid_evidence'); continue; }
      const fingerprint = hash([row.id, row.content, row.timestamp, row.senderId, source ?? null]);
      if (known.has(sourceId)) {
        if (known.get(sourceId) !== fingerprint) throw new Error('Conflicting receipts for one journal message identity');
        continue;
      }
      known.set(sourceId, fingerprint);
      if (text(row.senderId) !== text(identity.senderId) || (source && (text(source.senderId) !== text(identity.senderId)
        || conversationId !== text(identity.conversationId) || messageId !== text(row.id)))) {
        refuse(sourceId, 'identity_mismatch'); continue;
      }
      const verified = source?.verified === true && source.platform === 'telegram';
      if (source && !verified || !source && !preview) { refuse(sourceId, 'unverified_evidence'); continue; }
      if (verified && source.contentHash !== hash([text(row.id), text(row.senderId), conversationId, row.content, row.timestamp])) {
        refuse(sourceId, 'edited_evidence'); continue;
      }
      const at = instant(row.timestamp, timezone);
      if (!Number.isFinite(at)) { refuse(sourceId, 'invalid_timestamp'); continue; }
      messages.push({ ref: `journalist:msg:${sourceId}`, sourceId, conversationId, messageId, at,
        localDate: moment.tz(at, timezone).format('YYYY-MM-DD'), content: row.content,
        senderId: text(row.senderId), verified, previewOnly: !verified,
        senderMatchesConfiguredUser: true, source: 'user' });
    }
    if (rejected.length) this.#logger?.warn?.('lifelog.knowledge.evidence-rejected', { count: rejected.length });
    messages.sort((a,b) => a.at - b.at || a.sourceId.localeCompare(b.sourceId));
    return { messages, rejected };
  }

  async readUserMessages({ username, after, through, preview = false }) {
    const lower = typeof after === 'object' && after !== null ? after.since : after;
    const since = typeof lower === 'number' ? lower : Date.parse(lower);
    const until = typeof through === 'number' ? through : Date.parse(through);
    if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) throw new Error('Journal evidence needs an explicit bounded range');
    const seen = new Set(typeof after === 'object' ? after?.seen ?? [] : []);
    const result = await this.#read(username, preview);
    const messages = result.messages.filter(row => row.at >= since && row.at <= until && !seen.has(row.sourceId)).slice(0, MAX_BATCH);
    for (const message of messages) seen.add(message.sourceId);
    return { messages, rejected: result.rejected, cursor: { since, seen: [...seen].sort() } };
  }

  async readByRefs({ username, refs, preview = false }) {
    const wanted = new Set(refs);
    return (await this.#read(username, preview)).messages.filter(row => wanted.has(row.ref));
  }
}
