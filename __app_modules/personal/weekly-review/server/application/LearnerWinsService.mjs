/**
 * Each child's wins for the weekly showcase: silver and gems earned (economy
 * ledger) and fitness rings, this week and all time.
 *
 * Both sources belong to other apps and come in as plain functions:
 *   ledger(learnerId)              -> Promise<rows[]|null>  (null: no wallet, reads 0)
 *   rings({ learnerId, from, to }) -> Promise<number>       (study days, `to` inclusive)
 * A missing source reads null (the client hides it). A source that throws for
 * one learner reads null for that learner and that source only.
 *
 * All-time rings walk every session summary since the start, so they are
 * remembered per learner and last date for `allTimeTtlMs` (10 minutes by
 * default). Silver and gems are summed from the ledger each time: the ledger
 * read is one local file walk per child.
 */
import { sumEarned } from '../domain/learnerWinsPolicy.mjs';

const ALL_TIME_FROM = '2000-01-01';
const DEFAULT_ALL_TIME_TTL_MS = 10 * 60_000;

export class LearnerWinsService {
  #ledger;
  #rings;
  #logger;
  #clock;
  #allTimeTtlMs;
  #allTimeRings = new Map(); // `${learnerId}|${to}` -> { value, at }

  constructor({ ledger = null, rings = null, logger = null, clock = () => new Date(), allTimeTtlMs } = {}) {
    this.#ledger = typeof ledger === 'function' ? ledger : null;
    this.#rings = typeof rings === 'function' ? rings : null;
    this.#logger = logger;
    this.#clock = clock;
    this.#allTimeTtlMs = Number.isFinite(allTimeTtlMs) && allTimeTtlMs >= 0 ? allTimeTtlMs : DEFAULT_ALL_TIME_TTL_MS;
  }

  /**
   * @param {{ learnerIds: string[], dates: string[], windowStartMs: number, windowEndMs: number }} args
   * @returns {Promise<Record<string, { week: {silver, gems, rings}, allTime: {silver, gems, rings} }>>}
   */
  async execute({ learnerIds, dates, windowStartMs, windowEndMs }) {
    const ids = [...new Set((learnerIds || []).filter((id) => typeof id === 'string' && id))];
    if (ids.length === 0 || !Array.isArray(dates) || dates.length === 0) return {};
    const started = this.#clock().getTime();
    const from = dates[0];
    const to = dates[dates.length - 1];

    const entries = await Promise.all(ids.map(async (learnerId) => {
      const [coins, rings] = await Promise.all([
        this.#coins(learnerId, { startMs: windowStartMs, endMs: windowEndMs }),
        this.#ringsFor(learnerId, from, to),
      ]);
      return [learnerId, {
        week: { silver: coins.week.silver, gems: coins.week.gems, rings: rings.week },
        allTime: { silver: coins.allTime.silver, gems: coins.allTime.gems, rings: rings.allTime },
      }];
    }));

    this.#logger?.info?.('weekly-review.wins.loaded', { learners: ids.length, ms: this.#clock().getTime() - started });
    return Object.fromEntries(entries);
  }

  async #coins(learnerId, window) {
    const none = { week: { silver: null, gems: null }, allTime: { silver: null, gems: null } };
    if (!this.#ledger) return none;
    try {
      return sumEarned(await this.#ledger(learnerId), window);
    } catch (err) {
      this.#failed(learnerId, 'ledger', err);
      return none;
    }
  }

  async #ringsFor(learnerId, from, to) {
    if (!this.#rings) return { week: null, allTime: null };
    const [week, allTime] = await Promise.all([
      this.#readRings(learnerId, from, to),
      this.#readAllTimeRings(learnerId, to),
    ]);
    return { week, allTime };
  }

  async #readRings(learnerId, from, to) {
    try {
      const value = await this.#rings({ learnerId, from, to });
      return Number.isFinite(value) ? value : 0;
    } catch (err) {
      this.#failed(learnerId, 'rings', err);
      return null;
    }
  }

  async #readAllTimeRings(learnerId, to) {
    const key = `${learnerId}|${to}`;
    const now = this.#clock().getTime();
    const hit = this.#allTimeRings.get(key);
    if (hit && now - hit.at < this.#allTimeTtlMs) return hit.value;
    const value = await this.#readRings(learnerId, ALL_TIME_FROM, to);
    if (value !== null) this.#allTimeRings.set(key, { value, at: now });
    return value;
  }

  #failed(learnerId, source, err) {
    this.#logger?.warn?.('weekly-review.wins.source-failed', { learnerId, source, error: err?.message ?? String(err) });
  }
}
