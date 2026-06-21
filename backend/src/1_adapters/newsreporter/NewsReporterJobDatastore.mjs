import { Job } from '#domains/scheduling/entities/Job.mjs';
import { IJobDatastore } from '#apps/scheduling/ports/IJobDatastore.mjs';

const REPORTER_TIMEOUT_MS = 120000;
const BUCKET = 'newsreporter';

/**
 * NewsReporterJobDatastore (1_adapters) — surfaces newsreporter reporters as
 * scheduler jobs.
 *
 * Reads the `newsreporter` household app config and synthesizes one
 * {@link Job} per enabled reporter, so cron lives SSOT in newsreporter.yml and
 * the existing scheduler (dependency checks, missed-run handling, nextRun) work
 * unchanged. Composed alongside the YAML job store via CompositeJobDatastore.
 *
 * @implements {import('#apps/scheduling/ports/IJobDatastore.mjs').IJobDatastore}
 */
export class NewsReporterJobDatastore extends IJobDatastore {
  #configService;
  #logger;

  /**
   * @param {{ configService: { getHouseholdAppConfig: Function }, logger?: object }} deps
   */
  constructor({ configService, logger } = {}) {
    super();
    if (!configService) throw new Error('NewsReporterJobDatastore requires a configService');
    this.#configService = configService;
    this.#logger = logger || console;
  }

  /**
   * Enabled reporters as `[id, reporter]` pairs, re-read from config each call.
   * Single source of truth for both loadJobs() and reporterIds().
   * @returns {Array<[string, object]>}
   */
  #enabledReporters() {
    const reporters = this.#configService.getHouseholdAppConfig(null, BUCKET) || {};
    return Object.entries(reporters).filter(([, reporter]) => reporter && reporter.enabled !== false);
  }

  /**
   * @returns {Promise<Job[]>} one Job per enabled reporter
   */
  async loadJobs() {
    const jobs = this.#enabledReporters().map(([id, reporter]) =>
      Job.fromObject({
        id,
        name: `${BUCKET}:${id}`,
        schedule: reporter.schedule,
        enabled: reporter.enabled !== false,
        timeout: REPORTER_TIMEOUT_MS,
        bucket: BUCKET,
      })
    );
    this.#logger.info?.('scheduler.jobStore.newsreporter_loaded', { count: jobs.length });
    return jobs;
  }

  /**
   * @param {string} jobId
   * @returns {Promise<Job|null>}
   */
  async getJob(jobId) {
    const jobs = await this.loadJobs();
    return jobs.find((j) => j.id === jobId || j.name === jobId) || null;
  }

  /**
   * Enabled reporter ids, re-read each call so new reporters register without a
   * restart. SYNCHRONOUS — the executor's canHandle() guards on `instanceof Set`,
   * so a Promise would silently disable dispatch. Consumed by
   * NewsReporterJobExecutor.canHandle().
   * @returns {Set<string>}
   */
  reporterIds() {
    return new Set(this.#enabledReporters().map(([id]) => id));
  }
}

export default NewsReporterJobDatastore;
