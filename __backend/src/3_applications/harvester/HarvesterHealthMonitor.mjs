/**
 * Watches every harvest result and pushes when a source stops working, goes stale,
 * or comes back. A failure is a thrown error or a result with status 'error';
 * skipped results (cooldown, dev, token writer disabled) don't count either way.
 *
 * Keep `failureThreshold` at or below the harvesters' circuit-breaker
 * `maxFailures` (3): once the breaker opens, harvests return skipped results
 * that this monitor ignores, so a higher threshold would never be reached.
 *
 * State is keyed by service id (one household). Records are applied one at a
 * time, so concurrent harvests can't overwrite each other's state; the store may
 * be sync or async. record() never rejects: a push or store failure is logged and
 * the harvest carries on. Pushes are sent after the queue step, never inside it.
 */
import { isFailedHarvest, describeHarvestFailure } from './ports/IHarvester.mjs';
import { composeHarvesterHealthPush, localDay } from '#domains/notification/push/harvesterHealthPush.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}/;

// Whole days between two 'YYYY-MM-DD' keys.
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export class HarvesterHealthMonitor {
  #store; #sendPush; #now; #timezone; #failureThreshold; #staleAfterDays; #skip; #logger;
  #chain = Promise.resolve();

  /**
   * @param {Object} deps
   * @param {{load: () => (Object|null|Promise<Object|null>), save: (state: Object) => (void|Promise<void>)}} deps.store
   * @param {(push: {title: string, message: string, data: Object}) => Promise<void>} deps.sendPush
   * @param {() => Date} [deps.now]
   * @param {string} [deps.timezone] - household zone for local days and times
   * @param {number} [deps.failureThreshold] - consecutive failures before 'failing'; keep ≤ breaker maxFailures
   * @param {Object<string, number>} [deps.staleAfterDays] - per service; unset means never stale
   * @param {string[]} [deps.skip] - services watched elsewhere (e.g. Strava)
   * @param {Object} [deps.logger]
   */
  constructor({ store, sendPush, now = () => new Date(), timezone = null, failureThreshold = 3, staleAfterDays = {}, skip = [], logger = console }) {
    if (!store || typeof sendPush !== 'function') throw new TypeError('HarvesterHealthMonitor requires store and sendPush');
    this.#store = store; this.#sendPush = sendPush; this.#now = now; this.#timezone = timezone;
    this.#failureThreshold = failureThreshold; this.#staleAfterDays = staleAfterDays;
    this.#skip = new Set(skip); this.#logger = logger;
  }

  /**
   * Resolves with the transition once state is saved. The push goes out after
   * that, outside the queue, so a slow or hung push never holds later records.
   * @returns {Promise<'failing'|'stale'|'recovered'|null>} the transition, if any
   */
  record(event = {}) {
    const step = this.#chain.then(() => this.#apply(event)).catch((err) => {
      this.#logger.warn?.('harvester.health.record_failed', { serviceId: event?.serviceId, error: err?.message });
      return null;
    });
    this.#chain = step;
    return step.then((outcome) => {
      if (!outcome) return null;
      void this.#push(outcome);
      return outcome.status;
    });
  }

  /**
   * Subscribe to harvest results, but only in the copy that owns the data (the
   * container, or a token writer). A dev checkout reading the same files would
   * otherwise record its own skipped or failed harvests and push about them.
   * @param {{onResult: Function}} harvesterService
   * @param {{enabled: boolean}} opts
   * @returns {boolean} whether it subscribed
   */
  watch(harvesterService, { enabled }) {
    if (!enabled) {
      this.#logger.info?.('harvester.health.disabled_non_production', { reason: 'not the container or a token writer' });
      return false;
    }
    harvesterService.onResult((event) => { this.record(event); });
    return true;
  }

  /** Current state per service id. */
  async report() {
    try {
      return (await this.#store.load()) || {};
    } catch (err) {
      this.#logger.warn?.('harvester.health.store_failed', { error: err?.message });
      return {};
    }
  }

  async #apply({ serviceId, result, error }) {
    if (!serviceId || this.#skip.has(serviceId)) return null;
    const failed = Boolean(error) || isFailedHarvest(result);
    if (!failed && result?.status !== 'success') return null;

    const now = this.#now();
    const nowIso = now.toISOString();
    let s;
    let transition = null;
    try {
      const state = (await this.#store.load()) || {};
      s = state[serviceId] || { status: 'healthy', failures: 0, lastSuccessAt: null, lastError: null, latestDate: null };

      if (failed) {
        s.failures += 1;
        s.lastError = error?.message || (error ? String(error) : describeHarvestFailure(result));
        if (s.status !== 'failing' && s.failures >= this.#failureThreshold) { s.status = 'failing'; transition = 'failing'; }
      } else {
        s.failures = 0; s.lastError = null; s.lastSuccessAt = nowIso;
        if (result.latestDate) s.latestDate = result.latestDate;
        const stale = this.#isStale(serviceId, s.latestDate, nowIso);
        if (stale && s.status !== 'stale') { s.status = 'stale'; transition = 'stale'; }
        else if (!stale && s.status !== 'healthy') { s.status = 'healthy'; transition = 'recovered'; }
      }

      s.updatedAt = nowIso;
      state[serviceId] = s;
      await this.#store.save(state);
    } catch (err) {
      // Unsaved state would re-announce the same transition on every harvest; stay quiet instead.
      this.#logger.warn?.('harvester.health.store_failed', { serviceId, error: err?.message });
      return null;
    }

    return transition ? { serviceId, status: transition, snapshot: { ...s }, now: nowIso } : null;
  }

  // Stale when the newest entry is more than N household calendar days old.
  #isStale(serviceId, latestDate, nowIso) {
    const days = this.#staleAfterDays[serviceId];
    if (!days || !DAY_KEY.test(String(latestDate ?? ''))) return false;
    const today = localDay(nowIso, this.#timezone);
    if (!today) return false;
    const age = daysBetween(String(latestDate).slice(0, 10), today);
    return Number.isFinite(age) && age > days;
  }

  async #push({ serviceId, status, snapshot: s, now }) {
    try {
      await this.#sendPush(composeHarvesterHealthPush({
        serviceId, status, error: s.lastError, lastSuccessAt: s.lastSuccessAt, latestDate: s.latestDate, now, timezone: this.#timezone,
      }));
      this.#logger.info?.('harvester.health.pushed', { serviceId, status });
    } catch (err) {
      this.#logger.warn?.('harvester.health.push_failed', { serviceId, status, error: err?.message });
    }
  }
}

export default HarvesterHealthMonitor;
