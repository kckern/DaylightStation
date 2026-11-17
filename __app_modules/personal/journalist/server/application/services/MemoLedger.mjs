/**
 * Memo Ledger
 * @module journalist/application/services/MemoLedger
 *
 * What the backend remembers about a user's voice memos between requests:
 * how far each memo got, so a retry finishes the work instead of starting it
 * again. The store keeps it across restarts.
 *
 * It also keeps the user's daily allowance: how many memos and how many bytes
 * of audio have been sent for transcription since local midnight.
 *
 * Ledger document:
 *   memos:
 *     <memo id>: { startedAt, saved, echoSent, followUpSent, outcome }
 *   days:
 *     <YYYY-MM-DD>: { memoIds: [<memo id>, ...], bytes }
 */

import { formatLocalTimestamp } from '#system/utils/time.mjs';

export const DEFAULT_MEMO_LIMITS = Object.freeze({ memos: 60, bytes: 200 * 1024 * 1024 });

// Records outlive the 30 days a memo's recorded time is believed for.
const KEEP_RECORDS_MS = 35 * 24 * 60 * 60 * 1000;

/**
 * The daily voice memo allowance from the journalist app config
 * (`voice_memo: { daily_memos, daily_megabytes }`). A value that is missing
 * or is not a positive number leaves the ledger's default in place.
 * @param {{daily_memos?: number, daily_megabytes?: number}} [config]
 * @returns {{memos?: number, bytes?: number}}
 */
export function memoLimits(config = {}) {
  const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
  const memos = positive(config?.daily_memos);
  const megabytes = positive(config?.daily_megabytes);
  return {
    ...(memos ? { memos: Math.floor(memos) } : {}),
    ...(megabytes ? { bytes: Math.floor(megabytes * 1024 * 1024) } : {}),
  };
}

export class MemoLedger {
  #store;
  #clock;
  #limits;
  #timezone;

  /**
   * @param {Object} deps
   * @param {import('../ports/IMemoLedgerStore.mjs').IMemoLedgerStore} deps.store
   * @param {() => number} [deps.clock] - Epoch ms
   * @param {{memos?: number, bytes?: number}} [deps.limits] - Per user, per local day
   * @param {(username: string) => string} [deps.timezone] - IANA zone the day is counted in
   */
  constructor({ store, clock = Date.now, limits = {}, timezone = () => undefined } = {}) {
    if (!store?.read || !store?.write) throw new Error('store is required');
    this.#store = store;
    this.#clock = clock;
    this.#limits = { ...DEFAULT_MEMO_LIMITS, ...limits };
    this.#timezone = timezone;
  }

  /**
   * Whether `bytes` of audio for this memo may go to transcription today.
   * A memo that will not be transcribed again (its entry is saved, or it was
   * found empty) is always admitted: finishing it costs nothing.
   * @returns {{allowed: true} | {allowed: false, limit: 'memos'|'bytes', retryAfterSeconds: number}}
   */
  admission(username, memoId, bytes = 0) {
    const ledger = this.#load(username);
    const record = ledger.memos[memoId];
    if (record?.saved || record?.outcome === 'empty') return { allowed: true };

    const { today, secondsToMidnight } = this.#localDay(username);
    const day = ledger.days[today] || { memoIds: [], bytes: 0 };
    const refuse = (limit) => ({ allowed: false, limit, retryAfterSeconds: secondsToMidnight });
    if (!day.memoIds.includes(memoId) && day.memoIds.length >= this.#limits.memos) return refuse('memos');
    if (day.bytes + Math.max(0, Number(bytes) || 0) > this.#limits.bytes) return refuse('bytes');
    return { allowed: true };
  }

  /** Count one transcription attempt against today, and start the memo's record. */
  countTranscription(username, memoId, bytes = 0) {
    const ledger = this.#load(username);
    const { today } = this.#localDay(username);
    const day = ledger.days[today] || { memoIds: [], bytes: 0 };
    ledger.days = {
      [today]: {
        memoIds: day.memoIds.includes(memoId) ? day.memoIds : [...day.memoIds, memoId],
        bytes: day.bytes + Math.max(0, Number(bytes) || 0),
      },
    };
    ledger.memos[memoId] = {
      startedAt: new Date(this.#clock()).toISOString(),
      ...ledger.memos[memoId],
      saved: false,
    };
    this.#save(username, ledger);
  }

  /** What the user has used today. */
  usage(username) {
    const day = this.#load(username).days[this.#localDay(username).today];
    return { memos: day?.memoIds?.length ?? 0, bytes: day?.bytes ?? 0 };
  }

  /** Today's date where the user lives, and how long until it ends. */
  #localDay(username) {
    // 'YYYY-MM-DD HH:mm:ss' in the user's zone (the household default when none is given).
    const local = formatLocalTimestamp(new Date(this.#clock()), this.#timezone(username) || undefined);
    const [today, time] = local.split(' ');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return { today, secondsToMidnight: Math.max(1, 86400 - (hours * 3600 + minutes * 60 + seconds)) };
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
    return { ...stored, memos: { ...(stored.memos || {}) }, days: { ...(stored.days || {}) } };
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
