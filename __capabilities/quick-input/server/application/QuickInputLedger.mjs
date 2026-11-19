/**
 * Quick Input Ledger
 * @module quick-input/application/QuickInputLedger
 *
 * What the backend remembers about one user's quick inputs to one bot between
 * requests: how far each input got, so a retry finishes the work and does not
 * start it again, and how much of the day's allowance is used. The store keeps
 * it across restarts.
 *
 * Ledger document (one per user per bot):
 *   inputs:
 *     <kind>:<input id>: { startedAt, saved, <step>Sent..., outcome }
 *   days:
 *     <YYYY-MM-DD>: { inputIds: [<kind>:<input id>, ...], bytes, attempts }
 *
 * The allowance has three parts, all per user, per bot, per local day:
 *   - inputs:   distinct inputs sent to the bot for processing
 *   - bytes:    bytes sent for processing, counted on every attempt
 *   - attempts: every attempt that does work, four for each allowed input
 */

import { localDayParts } from './recordedTime.mjs';

export const DEFAULT_QUICK_INPUT_LIMITS = Object.freeze({ inputs: 60, bytes: 200 * 1024 * 1024 });

// A retry is an attempt too. This many attempts are allowed for each input in the allowance.
export const ATTEMPTS_PER_INPUT = 4;

// Records outlive the 30 days an input's recorded time is believed for.
const KEEP_RECORDS_MS = 35 * 24 * 60 * 60 * 1000;

const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/**
 * The daily allowance from a bot's app config
 * (`quick_input: { daily_inputs, daily_megabytes }`). A value that is missing
 * or is not a positive number leaves the default in place. `earlier` is the
 * block the Journalist voice intake started with
 * (`voice_memo: { daily_memos, daily_megabytes }`); `quick_input` wins.
 * @returns {{inputs?: number, bytes?: number}}
 */
export function quickInputLimits(config = {}, earlier = {}) {
  const inputs = positive(config?.daily_inputs) ?? positive(earlier?.daily_memos);
  const megabytes = positive(config?.daily_megabytes) ?? positive(earlier?.daily_megabytes);
  return {
    ...(inputs ? { inputs: Math.floor(inputs) } : {}),
    ...(megabytes ? { bytes: Math.floor(megabytes * 1024 * 1024) } : {}),
  };
}

const keyOf = (kind, inputId) => `${kind}:${inputId}`;
const amount = (bytes) => Math.max(0, Number(bytes) || 0);
const emptyDay = () => ({ inputIds: [], bytes: 0, attempts: 0 });

export class QuickInputLedger {
  #store;
  #clock;
  #limits;
  #timezone;

  /**
   * @param {Object} deps
   * @param {import('./ports/IQuickInputLedgerStore.mjs').IQuickInputLedgerStore} deps.store
   * @param {() => number} [deps.clock] - Epoch ms
   * @param {{inputs?: number, bytes?: number}} [deps.limits] - Per user, per local day
   * @param {(username: string) => string} [deps.timezone] - IANA zone the day is counted in
   */
  constructor({ store, clock = Date.now, limits = {}, timezone = () => undefined } = {}) {
    if (!store?.read || !store?.write) throw new Error('store is required');
    this.#store = store;
    this.#clock = clock;
    this.#limits = { ...DEFAULT_QUICK_INPUT_LIMITS, ...limits };
    this.#timezone = timezone;
  }

  /**
   * How far an input got, or null when this ledger has never seen it.
   * @returns {{startedAt: string, saved?: boolean, outcome?: string}|null}
   */
  record(username, kind, inputId) {
    return this.#load(username).inputs[keyOf(kind, inputId)] || null;
  }

  /** Note progress on an input. The first note starts its record. */
  mark(username, kind, inputId, progress = {}) {
    const ledger = this.#load(username);
    const key = keyOf(kind, inputId);
    ledger.inputs[key] = {
      startedAt: new Date(this.#clock()).toISOString(),
      ...ledger.inputs[key],
      ...progress,
    };
    this.#save(username, ledger);
    return ledger.inputs[key];
  }

  /**
   * Whether an attempt on this input may go ahead today.
   * An input with a final outcome is always admitted: answering it again does
   * no work. An input already saved is held only to the day's attempts, since
   * finishing its replies sends nothing new for processing.
   * @returns {{allowed: true} | {allowed: false, limit: 'inputs'|'bytes', retryAfterSeconds: number}}
   */
  admission(username, kind, inputId, bytes = 0, { processing = true } = {}) {
    const ledger = this.#load(username);
    const key = keyOf(kind, inputId);
    const record = ledger.inputs[key];
    if (record?.outcome) return { allowed: true };

    const { date, secondsToMidnight } = this.#localDay(username);
    const day = { ...emptyDay(), ...ledger.days[date] };
    const refuse = (limit) => ({ allowed: false, limit, retryAfterSeconds: secondsToMidnight });

    if (processing && !record?.saved) {
      if (!day.inputIds.includes(key) && day.inputIds.length >= this.#limits.inputs) return refuse('inputs');
      if (day.bytes + amount(bytes) > this.#limits.bytes) return refuse('bytes');
    }
    if (day.attempts >= this.#limits.inputs * ATTEMPTS_PER_INPUT) return refuse('inputs');
    return { allowed: true };
  }

  /**
   * Count one attempt against today.
   * `processing` is true when the input itself is sent to the bot: its id and
   * bytes count and its record starts. False for an attempt that only
   * finishes replies.
   */
  countAttempt(username, kind, inputId, bytes = 0, { processing = true } = {}) {
    const ledger = this.#load(username);
    const key = keyOf(kind, inputId);
    const { date } = this.#localDay(username);
    const day = { ...emptyDay(), ...ledger.days[date] };
    ledger.days = {
      [date]: {
        inputIds: !processing || day.inputIds.includes(key) ? day.inputIds : [...day.inputIds, key],
        bytes: day.bytes + (processing ? amount(bytes) : 0),
        attempts: day.attempts + 1,
      },
    };
    if (processing) {
      ledger.inputs[key] = {
        startedAt: new Date(this.#clock()).toISOString(),
        ...ledger.inputs[key],
        saved: false,
      };
    }
    this.#save(username, ledger);
  }

  /** What the user has used today. */
  usage(username) {
    const day = { ...emptyDay(), ...this.#load(username).days[this.#localDay(username).date] };
    return { inputs: day.inputIds.length, bytes: day.bytes, attempts: day.attempts };
  }

  /** Today's date where the user lives, and how long until it ends. */
  #localDay(username) {
    return localDayParts(this.#clock(), this.#timezone(username));
  }

  #load(username) {
    const stored = this.#store.read(username) || {};
    return { ...stored, inputs: { ...(stored.inputs || {}) }, days: { ...(stored.days || {}) } };
  }

  #save(username, ledger) {
    const cutoff = this.#clock() - KEEP_RECORDS_MS;
    for (const [key, record] of Object.entries(ledger.inputs)) {
      if (!(new Date(record?.startedAt).getTime() >= cutoff)) delete ledger.inputs[key];
    }
    if (this.#store.write(username, ledger) === false) throw new Error('Quick-input ledger write failed');
  }
}

export default QuickInputLedger;
