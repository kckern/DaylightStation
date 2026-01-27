/**
 * YamlJobDatastore - Loads job definitions from YAML files
 *
 * Jobs are defined in: {dataDir}/system/jobs.yml
 *
 * Job execution is handled by:
 * - HarvesterJobExecutor for jobs with matching harvester serviceId
 * - MediaJobExecutor for media jobs (youtube, etc.)
 * - Legacy module import for remaining jobs without executors
 */

import path from 'path';
import { Job } from '#domains/scheduling/entities/Job.mjs';
import { IJobDatastore } from '#apps/scheduling/ports/IJobDatastore.mjs';
import { loadYaml } from '#system/utils/FileIO.mjs';

export class YamlJobDatastore extends IJobDatastore {
  constructor({ dataDir, logger = console }) {
    super();
    this.dataDir = dataDir;
    this.logger = logger;
    this.jobsCache = null;
  }

  /**
   * Load all job definitions
   * @returns {Promise<Job[]>}
   */
  async loadJobs() {
    // Return cached if available
    if (this.jobsCache) {
      return this.jobsCache;
    }

    try {
      const jobsPath = path.join(this.dataDir, 'system', 'jobs');
      const jobsData = loadYaml(jobsPath);

      if (jobsData && Array.isArray(jobsData)) {
        this.logger.info?.('scheduler.jobStore.loaded', {
          count: jobsData.length,
          path: jobsPath
        });
        this.jobsCache = jobsData.map(j => Job.fromObject(j));
        return this.jobsCache;
      }

      this.logger.warn?.('scheduler.jobStore.missing', {
        message: 'No job definitions found',
        path: jobsPath
      });
      return [];
    } catch (error) {
      this.logger.error?.('scheduler.jobStore.error', { error: error.message });
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
    this.jobsCache = null;
  }
}

export default YamlJobDatastore;
