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
   * @returns {Promise<Job[]>} one Job per enabled reporter
   */
  async loadJobs() {
    const reporters = this.#configService.getHouseholdAppConfig(null, BUCKET) || {};
    const jobs = [];
    for (const [id, reporter] of Object.entries(reporters)) {
      if (!reporter || reporter.enabled === false) continue;
      jobs.push(
        Job.fromObject({
          id,
          name: `${BUCKET}:${id}`,
          schedule: reporter.schedule,
          enabled: reporter.enabled !== false,
          timeout: REPORTER_TIMEOUT_MS,
          bucket: BUCKET,
        })
      );
    }
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
   * restart. Consumed by NewsReporterJobExecutor.canHandle().
   * @returns {Promise<Set<string>>}
   */
  async reporterIds() {
    const reporters = this.#configService.getHouseholdAppConfig(null, BUCKET) || {};
    const ids = new Set();
    for (const [id, reporter] of Object.entries(reporters)) {
      if (!reporter || reporter.enabled === false) continue;
      ids.add(id);
    }
    return ids;
  }
}

export default NewsReporterJobDatastore;
