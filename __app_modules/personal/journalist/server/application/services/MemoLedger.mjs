/**
 * Memo Ledger
 * @module journalist/application/services/MemoLedger
 *
 * What the backend remembers about a user's voice memos between requests:
 * how far each memo got, so a retry finishes the work instead of starting it
 * again. The store keeps it across restarts.
 *
 * Ledger document:
 *   memos:
 *     <memo id>: { startedAt, saved, echoSent, followUpSent, outcome }
 */

// Records outlive the 30 days a memo's recorded time is believed for.
const KEEP_RECORDS_MS = 35 * 24 * 60 * 60 * 1000;

export class MemoLedger {
  #store;
  #clock;

  /**
   * @param {Object} deps
   * @param {import('../ports/IMemoLedgerStore.mjs').IMemoLedgerStore} deps.store
   * @param {() => number} [deps.clock] - Epoch ms
   */
  constructor({ store, clock = Date.now } = {}) {
    if (!store?.read || !store?.write) throw new Error('store is required');
    this.#store = store;
    this.#clock = clock;
  }

  /**
   * How far a memo got, or null when this ledger has never seen it.
   * @returns {{startedAt: string, saved?: boolean, echoSent?: boolean, followUpSent?: boolean, outcome?: string}|null}
   */
  record(username, memoId) {
    return this.#load(username).memos[memoId] || null;
  }

  /** Note progress on a memo. The first note starts its record. */
  mark(username, memoId, progress = {}) {
    const ledger = this.#load(username);
    ledger.memos[memoId] = {
      startedAt: new Date(this.#clock()).toISOString(),
      ...ledger.memos[memoId],
      ...progress,
    };
    this.#save(username, ledger);
    return ledger.memos[memoId];
  }

  #load(username) {
    const stored = this.#store.read(username) || {};
    return { ...stored, memos: { ...(stored.memos || {}) } };
  }

  #save(username, ledger) {
    const cutoff = this.#clock() - KEEP_RECORDS_MS;
    for (const [memoId, record] of Object.entries(ledger.memos)) {
      if (!(new Date(record?.startedAt).getTime() >= cutoff)) delete ledger.memos[memoId];
    }
    this.#store.write(username, ledger);
  }
}

export default MemoLedger;
