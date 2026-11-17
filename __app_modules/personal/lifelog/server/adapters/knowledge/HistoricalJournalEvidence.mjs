import crypto from 'node:crypto';
import { JournalKnowledgeEvidence } from './JournalKnowledgeEvidence.mjs';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read-only import candidates. Legacy authorship is not a Telegram attestation. */
export class HistoricalJournalEvidence {
  #load;
  #identity;
  #timezone;
  #logger;
  constructor({
    loadJournal,
    identityForUser,
    timezoneForUser,
    logger
  }) {
    this.#load = loadJournal;
    this.#identity = identityForUser;
    this.#timezone = timezoneForUser;
    this.#logger = logger;
  }
  async read({
    username,
    from,
    asOf,
    cursor
  }) {
    if (!Number.isFinite(from) || !Number.isFinite(asOf) || from > asOf || asOf - from > 90 * 86400000) throw new TypeError('Invalid historical range');
    const binding = hash([username, from, asOf]);
    if (cursor != null && (cursor.binding !== binding || !cursor.inner || cursor.inner.since !== from || !Array.isArray(cursor.inner.seen))) throw new TypeError('Invalid historical cursor');
    // Capture once: pagination and source hashes must describe the same read.
    const journal = structuredClone(await this.#load(username));
    const identity = structuredClone(await this.#identity(username));
    const timezone = this.#timezone(username);
    const reader = new JournalKnowledgeEvidence({
      loadJournal: async () => journal,
      identityForUser: async () => identity,
      timezoneForUser: () => timezone,
      logger: this.#logger
    });
    const page = await reader.readUserMessages({
      username,
      after: cursor?.inner ?? from,
      through: asOf,
      preview: true
    });
    const following = await reader.readUserMessages({
      username,
      after: page.cursor,
      through: asOf,
      preview: true
    });
    const rows = new Map((journal?.messages ?? []).map(row => [String(row?.id), row]));
    const sourceHashes = {};
    const messages = page.messages.filter(row => row.at >= from && row.at <= asOf).map(row => {
      const sourceHash = hash([username, identity, timezone, rows.get(row.messageId)]);
      sourceHashes[row.ref] = sourceHash;
      const sourceId = hash([row.sourceId, sourceHash]);
      return {
        ...row,
        originalRef: row.ref,
        originalSourceId: row.sourceId,
        sourceHash,
        sourceId,
        ref: 'journalist:msg:' + sourceId,
        origin: 'historical_import',
        verified: false,
        previewOnly: true
      };
    });
    return {
      messages,
      rejected: page.rejected.filter(row => row.at == null || row.at >= from && row.at <= asOf),
      nextCursor: {
        binding,
        inner: page.cursor
      },
      sourceHashes,
      complete: following.messages.length === 0 && following.resolved.length === 0
    };
  }
}
