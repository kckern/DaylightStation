/**
 * Memo Ledger
 * @module journalist/application/services/MemoLedger
 *
 * The Journalist's quick-input ledger, seen as the voice memo intake has
 * always seen it: memos by id, a daily allowance of memos and bytes. It is a
 * view over the shared QuickInputLedger (kind `voice`), which holds the rules
 * and the stored document; the typed-note intake counts against the same day
 * through that ledger.
 */

import {
  QuickInputLedger, quickInputLimits, DEFAULT_QUICK_INPUT_LIMITS,
} from '../../../../../../__capabilities/quick-input/server/public.mjs';

const KIND = 'voice';

export const DEFAULT_MEMO_LIMITS = Object.freeze({
  memos: DEFAULT_QUICK_INPUT_LIMITS.inputs, bytes: DEFAULT_QUICK_INPUT_LIMITS.bytes,
});

/**
 * The daily voice memo allowance from the journalist app config's earlier
 * block (`voice_memo: { daily_memos, daily_megabytes }`). A value that is
 * missing or is not a positive number leaves the default in place.
 * @param {{daily_memos?: number, daily_megabytes?: number}} [config]
 * @returns {{memos?: number, bytes?: number}}
 */
export function memoLimits(config = {}) {
  const { inputs, bytes } = quickInputLimits({}, config || {});
  return { ...(inputs ? { memos: inputs } : {}), ...(bytes ? { bytes } : {}) };
}

const inMemoTerms = (admission) => (admission.allowed
  ? admission
  : { ...admission, limit: admission.limit === 'inputs' ? 'memos' : admission.limit });

export class MemoLedger {
  #ledger;

  /**
   * @param {Object} deps
   * @param {import('../ports/IMemoLedgerStore.mjs').IMemoLedgerStore} [deps.store]
   * @param {() => number} [deps.clock] - Epoch ms
   * @param {{memos?: number, bytes?: number}} [deps.limits] - Per user, per local day
   * @param {(username: string) => string} [deps.timezone] - IANA zone the day is counted in
   * @param {QuickInputLedger} [deps.ledger] - The shared ledger to view, in place of a store
   */
  constructor({ store, clock = Date.now, limits = {}, timezone = () => undefined, ledger = null } = {}) {
    if (ledger) {
      this.#ledger = ledger;
      return;
    }
    const { memos, ...rest } = limits || {};
    this.#ledger = new QuickInputLedger({
      store, clock, timezone, limits: { ...rest, ...(memos === undefined ? {} : { inputs: memos }) },
    });
  }

  /** The shared ledger this is a view over. */
  get ledger() { return this.#ledger; }

  /** How far a memo got, or null when this ledger has never seen it. */
  record(username, memoId) { return this.#ledger.record(username, KIND, memoId); }

  /** Note progress on a memo. The first note starts its record. */
  mark(username, memoId, progress = {}) { return this.#ledger.mark(username, KIND, memoId, progress); }

  /**
   * Whether `bytes` of audio for this memo may go to transcription today.
   * @returns {{allowed: true} | {allowed: false, limit: 'memos'|'bytes', retryAfterSeconds: number}}
   */
  admission(username, memoId, bytes = 0) {
    return inMemoTerms(this.#ledger.admission(username, KIND, memoId, bytes));
  }

  /** Count one transcription attempt against today, and start the memo's record. */
  countTranscription(username, memoId, bytes = 0) { this.#ledger.countAttempt(username, KIND, memoId, bytes); }

  /** What the user has used today. */
  usage(username) {
    const { inputs, bytes } = this.#ledger.usage(username);
    return { memos: inputs, bytes };
  }
}

export default MemoLedger;
