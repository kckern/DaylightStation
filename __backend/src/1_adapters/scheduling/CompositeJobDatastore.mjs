import { IJobDatastore } from '#apps/scheduling/ports/IJobDatastore.mjs';

/**
 * CompositeJobDatastore (1_adapters) — merges multiple IJobDatastore sources
 * into one the SchedulerOrchestrator can consume unchanged.
 *
 * `loadJobs()` concatenates every store's jobs in order. On a duplicate `id`
 * the EARLIER store wins (so the canonical jobs.yml store precedes the
 * newsreporter store) and a `scheduler.jobStore.id_collision` warning is
 * logged. Other IJobDatastore methods (e.g. getJob) delegate to the first
 * store that implements them, with a merged-scan fallback.
 *
 * @implements {import('#apps/scheduling/ports/IJobDatastore.mjs').IJobDatastore}
 */
export class CompositeJobDatastore extends IJobDatastore {
  #stores;
  #logger;

  /**
   * @param {{ stores: import('#apps/scheduling/ports/IJobDatastore.mjs').IJobDatastore[], logger?: object }} deps
   */
  constructor({ stores, logger } = {}) {
    super();
    if (!Array.isArray(stores) || stores.length === 0) {
      throw new Error('CompositeJobDatastore requires a non-empty stores array');
    }
    this.#stores = stores;
    this.#logger = logger || console;
  }

  /**
   * @returns {Promise<import('#domains/scheduling/entities/Job.mjs').Job[]>}
   */
  async loadJobs() {
    const merged = [];
    const seen = new Set();
    const allJobs = await Promise.all(this.#stores.map((s) => s.loadJobs()));
    for (const jobs of allJobs) {
      for (const job of jobs || []) {
        if (seen.has(job.id)) {
          this.#logger.warn?.('scheduler.jobStore.id_collision', { id: job.id });
          continue; // earlier store wins
        }
        seen.add(job.id);
        merged.push(job);
      }
    }
    return merged;
  }

  /**
   * Delegate to the first store that overrides getJob; otherwise scan merged jobs.
   * @param {string} jobId
   * @returns {Promise<import('#domains/scheduling/entities/Job.mjs').Job|null>}
   */
  async getJob(jobId) {
    for (const store of this.#stores) {
      if (implementsOwn(store, 'getJob')) {
        const job = await store.getJob(jobId);
        if (job) return job;
      }
    }
    const jobs = await this.loadJobs();
    return jobs.find((j) => j.id === jobId || j.name === jobId) || null;
  }
}

/**
 * True when `obj` provides its own `method` (not just the inherited
 * IJobDatastore base stub, which throws "Not implemented").
 */
function implementsOwn(obj, method) {
  if (typeof obj?.[method] !== 'function') return false;
  return obj[method] !== IJobDatastore.prototype[method];
}

export default CompositeJobDatastore;
