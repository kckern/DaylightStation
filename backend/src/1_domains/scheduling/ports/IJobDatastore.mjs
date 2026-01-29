/**
 * IJobDatastore - Interface for loading job definitions
 *
 * Implementations:
 * - YamlJobStore: Loads from system/jobs.yml
 */
export class IJobDatastore {
  /**
   * Load all job definitions
   * @returns {Promise<import('../entities/Job.mjs').Job[]>}
   */
  async loadJobs() {
    throw new Error('Not implemented');
  }

  /**
   * Get a specific job by ID
   * @param {string} jobId
   * @returns {Promise<import('../entities/Job.mjs').Job|null>}
   */
  async getJob(jobId) {
    throw new Error('Not implemented');
  }
}

export default IJobDatastore;
