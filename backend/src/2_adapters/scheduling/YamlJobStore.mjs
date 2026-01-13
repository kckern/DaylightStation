/**
 * YamlJobStore - Loads job definitions from YAML files
 *
 * Looks for jobs in:
 * 1. system/jobs.yml (modern format)
 * 2. system/cron-jobs.yml (legacy format, migrated on load)
 */

import { Job } from '../../1_domains/scheduling/entities/Job.mjs';
import { IJobStore } from '../../1_domains/scheduling/ports/IJobStore.mjs';

// Legacy bucket mappings for migration
const LEGACY_BUCKETS = {
  cron10Mins: [
    "../lib/weather.mjs",
    "../lib/gcal.mjs",
    "../lib/todoist.mjs",
    "../lib/gmail.mjs",
  ],
  cronHourly: [
    "../lib/withings.mjs",
    "../lib/strava.mjs",
    "../lib/lastfm.mjs",
    "../lib/clickup.mjs",
    "../lib/foursquare.mjs",
    "../lib/budget.mjs",
  ],
  cronDaily: [
    "../lib/youtube.mjs",
    "../lib/fitsync.mjs",
    "../lib/garmin.mjs",
    "../lib/health.mjs",
    "../lib/letterboxd.mjs",
    "../lib/goodreads.mjs",
    "../lib/github.mjs",
    "../lib/reddit.mjs",
    "../lib/shopping.mjs",
    "../lib/archiveRotation.mjs",
    "../lib/mediaMemoryValidator.mjs",
  ],
  cronWeekly: []
};

export class YamlJobStore extends IJobStore {
  constructor({ loadFile, logger = console }) {
    super();
    this.loadFile = loadFile;
    this.logger = logger;
    this.jobsCache = null;
  }

  /**
   * Migrate legacy bucket-based jobs to modern format
   */
  migrateLegacyJobs(legacyJobs) {
    const modernJobs = [];

    for (const legacy of legacyJobs) {
      const bucketName = legacy.name;
      const bucketModules = LEGACY_BUCKETS[bucketName];

      if (bucketModules) {
        bucketModules.forEach((modulePath) => {
          const id = modulePath.split('/').pop().replace('.mjs', '');
          modernJobs.push(Job.fromObject({
            id: `${bucketName}-${id}`,
            name: `${bucketName}: ${id}`,
            module: modulePath,
            schedule: legacy.cron_tab,
            window: legacy.window || '0',
            bucket: bucketName
          }));
        });
      }
    }

    return modernJobs;
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
      // Try modern format first
      let jobsData = this.loadFile('system/jobs');

      if (jobsData && Array.isArray(jobsData)) {
        this.logger.info?.('scheduler.jobStore.loaded', {
          count: jobsData.length,
          format: 'modern'
        });
        this.jobsCache = jobsData.map(j => Job.fromObject(j));
        return this.jobsCache;
      }

      // Fallback to legacy format
      const legacyJobs = this.loadFile('system/cron-jobs');
      if (legacyJobs && Array.isArray(legacyJobs)) {
        this.logger.info?.('scheduler.jobStore.loaded', {
          count: legacyJobs.length,
          format: 'legacy'
        });
        this.jobsCache = this.migrateLegacyJobs(legacyJobs);
        return this.jobsCache;
      }

      this.logger.warn?.('scheduler.jobStore.missing', {
        message: 'No job definitions found'
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

export default YamlJobStore;
