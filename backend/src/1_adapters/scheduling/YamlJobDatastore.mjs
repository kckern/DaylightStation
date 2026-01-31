/**
 * YamlJobDatastore - Loads job definitions from YAML files
 *
 * Jobs are defined in: {dataDir}/system/config/jobs.yml
 *
 * Job execution is handled by:
 * - HarvesterJobExecutor for jobs with matching harvester serviceId
 * - MediaJobExecutor for media jobs (youtube, etc.)
 * - Legacy module import for remaining jobs without executors
 *
 * Uses DataService for filesystem abstraction - adapter does not
 * interact with filesystem directly.
 */

import { Job } from '#domains/scheduling/entities/Job.mjs';
import { IJobDatastore } from '#apps/scheduling/ports/IJobDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const JOBS_PATH = 'config/jobs';

export class YamlJobDatastore extends IJobDatastore {
  #dataService;
  #logger;
  #jobsCache = null;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) {
      throw new InfrastructureError('YamlJobDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Load all job definitions
   * @returns {Promise<Job[]>}
   */
  async loadJobs() {
    // Return cached if available
    if (this.#jobsCache) {
      return this.#jobsCache;
    }

    try {
      const jobsData = this.#dataService.system.read(JOBS_PATH);

      if (jobsData && Array.isArray(jobsData)) {
        this.#logger.info?.('scheduler.jobStore.loaded', {
          count: jobsData.length
        });
        this.#jobsCache = jobsData.map(j => Job.fromObject(j));
        return this.#jobsCache;
      }

      this.#logger.warn?.('scheduler.jobStore.missing', {
        message: 'No job definitions found'
      });
      return [];
    } catch (error) {
      this.#logger.error?.('scheduler.jobStore.error', { error: error.message });
      return [];
    }
  }

  /**
   * Get a specific job by ID
   * @param {string} jobId
   * @returns {Promise<Job|null>}
   */
  async getJob(jobId) {
    const jobs = await this.loadJobs();
    return jobs.find(j => j.id === jobId || j.name === jobId) || null;
  }

  /**
   * Clear the cache (for reloading after config changes)
   */
  clearCache() {
    this.#jobsCache = null;
  }
}

export default YamlJobDatastore;
