import { loadFile } from '../io.mjs';
import { createLogger } from '../logging/logger.js';

const logger = createLogger({
  source: 'backend',
  app: 'cron',
  context: { component: 'TaskRegistry' }
});

export class TaskRegistry {
  constructor() {
    this.jobs = [];
  }

  /**
   * Load jobs from the centralized jobs.yml or fallback to legacy cron-jobs.yml
   */
  load() {
    try {
      // Try new format first
      let jobs = loadFile('system/jobs');
      
      if (jobs && Array.isArray(jobs)) {
        logger.info('cron.registry.loaded', { count: jobs.length, format: 'modern' });
        this.jobs = jobs;
        return this.jobs;
      }

      // Fallback to legacy structure if available
      const legacyJobs = loadFile('system/cron-jobs');
      if (legacyJobs && Array.isArray(legacyJobs)) {
        logger.info('cron.registry.loaded', { count: legacyJobs.length, format: 'legacy' });
        this.jobs = this.migrateLegacy(legacyJobs);
        return this.jobs;
      }

      logger.warn('cron.registry.missing', { message: 'No job definitions found in system/jobs or system/cron-jobs' });
      return [];
    } catch (error) {
      logger.error('cron.registry.load_error', { error: error.message });
      return [];
    }
  }

  /**
   * Temporary migration helper to bridge the gap between bucket-based cron
   * and the new individual task model.
   */
  migrateLegacy(legacyJobs) {
    // Current hardcoded buckets in cron.mjs
    const buckets = {
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

    const modernJobs = [];

    for (const legacy of legacyJobs) {
      const bucketName = legacy.name;
      const bucketModules = buckets[bucketName];
      
      if (bucketModules) {
        bucketModules.forEach((modulePath, index) => {
          // Extract a readable ID from the module path
          const id = modulePath.split('/').pop().replace('.mjs', '');
          modernJobs.push({
            id: `${bucketName}-${id}`,
            name: `${bucketName}: ${id}`,
            module: modulePath,
            schedule: legacy.cron_tab,
            cron_tab: legacy.cron_tab, // Alias for backward compatibility
            window: legacy.window || "0",
            bucket: bucketName // Keep bucket info
          });
        });
      }
    }

    return modernJobs;
  }

  getJobs() {
    return this.jobs;
  }
}

export const taskRegistry = new TaskRegistry();
