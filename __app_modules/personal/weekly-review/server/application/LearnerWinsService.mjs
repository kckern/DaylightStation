/**
 * Each child's wins for the weekly showcase: silver and gems earned (economy
 * ledger) and fitness rings, this week and all time.
 *
 * Both sources belong to other apps and come in as plain functions:
 *   ledger(learnerId) -> Promise<rows[]|null>   (null: no wallet, reads 0)
 *   ringStandings({ learnerIds, fromMs, toMs })
 *     -> Promise<[{ learnerId, sessions: [{ startMs, rings }] }]>
 *     the fitness rings provider's `standings`: one session listing for the
 *     whole roster, sessions dated by the instant they STARTED.
 * A missing source reads null (the client hides it). A ledger that throws for
 * one learner reads null for that learner only; a ring listing that throws
 * reads null for every learner in it (it is one listing).
 *
 * Rings are summed here from each session's start instant, inside the review
 * window. The provider lists sessions by the day folder they were filed under
 * and stops at the study day of `toMs - 1`, so a workout started between
 * 00:00 and 04:00 the morning after the last date (study day = the last date)
 * would sit in a folder it never reads. The listing is therefore asked for one
 * day past the window, and anything that started at or after the window's end
 * is dropped.
 *
 * Reads are shared, not repeated: bootstrap and the showcase route ask for the
 * same window within seconds of each other. The ledger and the week's ring
 * listing are kept for 60 s; the all-time ring listing (every session summary
 * since the start) for 10 minutes. The in-flight promise is what is kept, so
 * two requests at once share one read. A failed read is forgotten at once.
 * Each cache holds at most 64 entries, least recently used evicted first.
 */
import { sumEarned } from '../domain/learnerWinsPolicy.mjs';

const ALL_TIME_FROM_MS = Date.parse('2000-01-01T00:00:00Z');
const DAY_MS = 86_400_000;
const DEFAULT_SHORT_TTL_MS = 60_000;
const DEFAULT_ALL_TIME_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 64;

/** A small LRU of promises with a per-cache TTL. */
class PromiseCache {
  #map = new Map(); // key -> { promise, at }
  #ttlMs;
  #clock;
  #max;

  constructor({ ttlMs, clock, max = MAX_ENTRIES }) {
    this.#ttlMs = ttlMs;
    this.#clock = clock;
    this.#max = max;
  }

  get size() { return this.#map.size; }

  get(key, load) {
    const now = this.#clock().getTime();
    const hit = this.#map.get(key);
    if (hit && now - hit.at < this.#ttlMs) {
      this.#map.delete(key);
      this.#map.set(key, hit); // most recently used last
      return hit.promise;
    }
    const promise = Promise.resolve().then(load);
    const entry = { promise, at: now };
    this.#map.delete(key);
    this.#map.set(key, entry);
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value);
    promise.catch(() => { if (this.#map.get(key) === entry) this.#map.delete(key); });
    return promise;
  }
}

/** `{ learnerId: rings }` from a standings answer, counting sessions started in `[fromMs, toMs)`. */
function sumRings(standings, learnerIds, fromMs, toMs) {
  const totals = Object.fromEntries(learnerIds.map((id) => [id, 0]));
  for (const row of Array.isArray(standings) ? standings : []) {
    if (!row || !(row.learnerId in totals)) continue;
    for (const s of Array.isArray(row.sessions) ? row.sessions : []) {
      if (!Number.isFinite(s?.startMs) || !Number.isFinite(s?.rings)) continue;
      if (s.startMs >= fromMs && s.startMs < toMs) totals[row.learnerId] += s.rings;
    }
  }
  return totals;
}

export class LearnerWinsService {
  #ledger;
  #ringStandings;
  #logger;
  #clock;
  #ledgerCache;
  #weekRingsCache;
  #allTimeRingsCache;

  constructor({ ledger = null, ringStandings = null, logger = null, clock = () => new Date(), shortTtlMs, allTimeTtlMs, maxEntries } = {}) {
    this.#ledger = typeof ledger === 'function' ? ledger : null;
    this.#ringStandings = typeof ringStandings === 'function' ? ringStandings : null;
    this.#logger = logger;
    this.#clock = clock;
    const ttl = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
    const max = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : MAX_ENTRIES;
    this.#ledgerCache = new PromiseCache({ ttlMs: ttl(shortTtlMs, DEFAULT_SHORT_TTL_MS), clock, max });
    this.#weekRingsCache = new PromiseCache({ ttlMs: ttl(shortTtlMs, DEFAULT_SHORT_TTL_MS), clock, max });
    this.#allTimeRingsCache = new PromiseCache({ ttlMs: ttl(allTimeTtlMs, DEFAULT_ALL_TIME_TTL_MS), clock, max });
  }

  /**
   * @param {{ learnerIds: string[], dates: string[], windowStartMs: number, windowEndMs: number }} args
   * @returns {Promise<Record<string, { week: {silver, gems, rings}, allTime: {silver, gems, rings} }>>}
   */
  async execute({ learnerIds, dates, windowStartMs, windowEndMs }) {
    const ids = [...new Set((learnerIds || []).filter((id) => typeof id === 'string' && id))].sort();
    if (ids.length === 0 || !Array.isArray(dates) || dates.length === 0) return {};
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) return {};
    const started = this.#clock().getTime();
    const window = { startMs: windowStartMs, endMs: windowEndMs };

    const [coins, rings] = await Promise.all([
      Promise.all(ids.map((id) => this.#coins(id, window))),
      this.#rings(ids, window),
    ]);

    const out = {};
    ids.forEach((learnerId, i) => {
      out[learnerId] = {
        week: { silver: coins[i].week.silver, gems: coins[i].week.gems, rings: rings.week?.[learnerId] ?? null },
        allTime: { silver: coins[i].allTime.silver, gems: coins[i].allTime.gems, rings: rings.allTime?.[learnerId] ?? null },
      };
    });
    this.#logger?.info?.('weekly-review.wins.loaded', { learners: ids.length, ms: this.#clock().getTime() - started });
    return out;
  }

  async #coins(learnerId, window) {
    const none = { week: { silver: null, gems: null }, allTime: { silver: null, gems: null } };
    if (!this.#ledger) return none;
    try {
      const rows = await this.#ledgerCache.get(learnerId, () => this.#ledger(learnerId));
      return sumEarned(rows, window);
    } catch (err) {
      this.#failed({ learnerId, source: 'ledger' }, err);
      return none;
    }
  }

  async #rings(ids, { startMs, endMs }) {
    if (!this.#ringStandings) return { week: null, allTime: null };
    const roster = ids.join(',');
    const [week, allTime] = await Promise.all([
      this.#ringListing(this.#weekRingsCache, `${roster}|${startMs}|${endMs}`, ids, startMs, endMs),
      this.#ringListing(this.#allTimeRingsCache, `${roster}|${endMs}`, ids, ALL_TIME_FROM_MS, endMs),
    ]);
    return { week, allTime };
  }

  async #ringListing(cache, key, ids, fromMs, toMs) {
    try {
      // One day past the window: see the header on day folders.
      const standings = await cache.get(key, () => this.#ringStandings({ learnerIds: ids, fromMs, toMs: toMs + DAY_MS }));
      return sumRings(standings, ids, fromMs, toMs);
    } catch (err) {
      this.#failed({ learnerIds: ids, source: 'rings' }, err);
      return null;
    }
  }

  #failed(who, err) {
    this.#logger?.warn?.('weekly-review.wins.source-failed', { ...who, error: err?.message ?? String(err) });
  }
}
