/**
 * Watches every harvest result and pushes when a source stops working, goes stale,
 * or comes back. A failure is a thrown error or a result with status 'error';
 * skipped results (cooldown, dev, token writer disabled) don't count either way.
 *
 * State is keyed by service id (one household). record() never rejects: a push
 * or store failure is logged and the harvest carries on.
 */
import { isFailedHarvest, describeHarvestFailure } from './ports/IHarvester.mjs';
import { composeHarvesterHealthPush } from '#domains/notification/push/harvesterHealthPush.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export class HarvesterHealthMonitor {
  #store; #sendPush; #now; #timezone; #failureThreshold; #staleAfterDays; #skip; #logger;

  /**
   * @param {Object} deps
   * @param {{load: () => Object|null, save: (state: Object) => void}} deps.store
   * @param {(push: {title: string, message: string, data: Object}) => Promise<void>} deps.sendPush
   * @param {() => Date} [deps.now]
   * @param {string} [deps.timezone] - household zone for local times in the copy
   * @param {number} [deps.failureThreshold] - consecutive failures before 'failing'
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

  /** @returns {Promise<'failing'|'stale'|'recovered'|null>} the transition, if any */
  async record({ serviceId, result, error } = {}) {
    if (!serviceId || this.#skip.has(serviceId)) return null;
    const failed = Boolean(error) || isFailedHarvest(result);
    if (!failed && result?.status !== 'success') return null;

    const nowIso = this.#now().toISOString();
    let s;
    let transition = null;
    try {
      const state = this.#store.load() || {};
      s = state[serviceId] || { status: 'healthy', failures: 0, lastSuccessAt: null, lastError: null, latestDate: null };

      if (failed) {
        s.failures += 1;
        s.lastError = error?.message || (error ? String(error) : describeHarvestFailure(result));
        if (s.status !== 'failing' && s.failures >= this.#failureThreshold) { s.status = 'failing'; transition = 'failing'; }
      } else {
        s.failures = 0; s.lastError = null; s.lastSuccessAt = nowIso;
        if (result.latestDate) s.latestDate = result.latestDate;
        const stale = this.#isStale(serviceId, s.latestDate);
        if (stale && s.status !== 'stale') { s.status = 'stale'; transition = 'stale'; }
        else if (!stale && s.status !== 'healthy') { s.status = 'healthy'; transition = 'recovered'; }
      }

      s.updatedAt = nowIso;
      state[serviceId] = s;
      this.#store.save(state);
    } catch (err) {
      // Unsaved state would re-announce the same transition on every harvest; stay quiet instead.
      this.#logger.warn?.('harvester.health.store_failed', { serviceId, error: err?.message });
      return null;
    }

    if (transition) await this.#push(serviceId, transition, s, nowIso);
    return transition;
  }

  /** Current state per service id. */
  report() {
    try {
      return this.#store.load() || {};
    } catch (err) {
      this.#logger.warn?.('harvester.health.store_failed', { error: err?.message });
      return {};
    }
  }

  #isStale(serviceId, latestDate) {
    const days = this.#staleAfterDays[serviceId];
    if (!days || !latestDate) return false;
    const day = Date.parse(`${latestDate}T00:00:00Z`);
    if (!Number.isFinite(day)) return false;
    return (this.#now().getTime() - day) / DAY_MS > days;
  }

  async #push(serviceId, status, s, now) {
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
