/**
 * FitnessSyncerHarvester
 *
 * Fetches activity data from FitnessSyncer API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - OAuth token refresh via FitnessSyncerAdapter
 * - Circuit breaker for rate limiting resilience
 * - Steps aggregation and activity normalization
 * - Incremental merge with anchor-date strategy
 * - Raw activity archiving (without GPS data)
 *
 * @module harvester/fitness/FitnessSyncerHarvester
 */

import moment from 'moment-timezone';
import crypto from 'crypto';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { FitnessSyncerAdapter } from './FitnessSyncerAdapter.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * FitnessSyncer activity harvester
 * @implements {IHarvester}
 */
export class FitnessSyncerHarvester extends IHarvester {
  #adapter;
  #lifelogStore;
  #configService;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client with get/post methods
   * @param {Object} config.lifelogStore - Store for reading/writing lifelog YAML
   * @param {Object} config.authStore - Store for reading/writing auth tokens
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    httpClient,
    lifelogStore,
    authStore,
    configService,
    timezone = 'America/New_York',
    logger = console,
  }) {
    super();

    if (!lifelogStore) {
      throw new InfrastructureError('FitnessSyncerHarvester requires lifelogStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'lifelogStore'
      });
    }

    this.#adapter = new FitnessSyncerAdapter({
      httpClient,
      authStore,
      configService,
      logger,
    });

    this.#lifelogStore = lifelogStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#logger = logger;
  }

  get serviceId() {
    return 'fitsync';
  }

  get category() {
    return HarvesterCategory.FITNESS;
  }

  /**
   * Harvest activities from FitnessSyncer
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.daysBack=7] - Days of history to fetch
   * @param {string} [options.sourceKey='GarminWellness'] - Provider key to fetch from
   * @returns {Promise<{ count: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { daysBack = 7, sourceKey = 'GarminWellness' } = options;

    // Dev mode bypass - skip API calls during development
    if (process.env.dev) {
      this.#logger?.info?.('fitsync.harvest.devMode', { message: 'Dev mode - skipping API call' });
      return { skipped: true, reason: 'dev_mode' };
    }

    // Check circuit breaker
    if (this.#adapter.isInCooldown()) {
      const cooldown = this.#adapter.getCooldownStatus();
      this.#logger.debug?.('fitsync.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        count: 0,
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('fitsync.harvest.start', { username, daysBack, sourceKey });

      // 1. Get access token (will auto-refresh if needed)
      const accessToken = await this.#adapter.getAccessToken(username);
      if (!accessToken) {
        return { count: 0, status: 'error', reason: 'auth_failed' };
      }

      // 2. Fetch raw activities via adapter
      const rawActivities = await this.#adapter.getActivities({ username, daysBack, sourceKey });
      if (!rawActivities || rawActivities.length === 0) {
        this.#logger.info?.('fitsync.harvest.no_data', { username, daysBack });
        return { count: 0, status: 'success' };
      }

      this.#logger.info?.('fitsync.harvest.fetched', {
        username,
        count: rawActivities.length,
      });

      // 3. Transform to legacy fitness.yml format + raw archive
      const { summary, archive, processedCount } = this.#transformActivities(rawActivities, username);

      // 4. Merge with existing data
      await this.#mergeSummary(username, summary);
      await this.#mergeArchive(username, archive);

      // Success - adapter already recorded success
      const latestDate = Object.keys(summary).sort().reverse()[0] || null;

      this.#logger.info?.('fitsync.harvest.complete', {
        username,
        processedCount,
        latestDate,
        datesAffected: Object.keys(summary).length,
      });

      return {
        count: processedCount,
        status: 'success',
        latestDate,
        datesAffected: Object.keys(summary).length,
      };

    } catch (error) {
      const statusCode = error.response?.status;
      const isRateLimit = statusCode === 429 ||
                         error.message?.includes('429') ||
                         error.message?.includes('Too Many Requests') ||
                         error.message?.includes('rate limit');

      this.#logger.error?.('fitsync.harvest.error', {
        username,
        error: this.#cleanErrorMessage(error),
        statusCode,
        circuitState: this.#adapter.getStatus().state,
      });

      throw error;
    }
  }

  /**
   * Transform raw FitnessSyncer activities to fitness.yml format
   *
   * @private
   * @param {Array} rawActivities - Raw activities from API
   * @param {string} username - Username for logging
   * @returns {{ summary: Object, archive: Object, processedCount: number }}
   */
  #transformActivities(rawActivities, username) {
    const summary = {}; // Date-keyed fitness summary
    const archive = {}; // Date-keyed raw activity archive
    let processedCount = 0;

    for (const activity of rawActivities) {
      // Build raw archive entry (without GPS to save space)
      const archiveEntry = this.#buildArchiveEntry(activity);
      if (!archiveEntry) continue; // Skip invalid dates

      const { date, id } = archiveEntry;

      // Add to archive
      if (!archive[date]) archive[date] = {};
      archive[date][id] = archiveEntry;

      // Build summary entry
      if (!summary[date]) {
        summary[date] = {
          steps: {},
          activities: [],
        };
      }

      // Transform to summary format
      if (activity.activity === 'Steps') {
        // Aggregate steps data
        const steps = summary[date].steps;
        steps.steps_count = (steps.steps_count || 0) + (activity.steps || 0);
        steps.bmr = (steps.bmr || 0) + (activity.bmr || 0);
        steps.duration = parseFloat(((steps.duration || 0) + ((activity.duration || 0) / 60)).toFixed(2));
        steps.calories = parseFloat(((steps.calories || 0) + (activity.calories || 0)).toFixed(2));
        steps.maxHeartRate = Math.max(steps.maxHeartRate || 0, activity.maxHeartrate || 0);
        
        // Average heart rate: accumulate for now, will need to be weighted properly
        // For simplicity, we'll use the max avgHeartrate seen (legacy behavior)
        steps.avgHeartRate = Math.max(steps.avgHeartRate || 0, activity.avgHeartrate || 0);
      } else {
        // Add to activities array
        summary[date].activities.push({
          title: activity.title || activity.type || '',
          calories: parseFloat((activity.calories || 0).toFixed(2)),
          distance: parseFloat((activity.distance || 0).toFixed(2)),
          minutes: parseFloat(((activity.duration || 0) / 60).toFixed(2)),
          startTime: activity.date ? moment(activity.date).tz(this.#timezone).format('hh:mm a') : '',
          endTime: activity.endDate ? moment(activity.endDate).tz(this.#timezone).format('hh:mm a') : '',
          avgHeartrate: parseFloat((activity.avgHeartrate || 0).toFixed(2)),
          steps: activity.steps || 0,
        });
      }

      processedCount++;
    }

    return { summary, archive, processedCount };
  }

  /**
   * Build raw archive entry for an activity
   *
   * @private
   * @param {Object} activity - Raw activity from API
   * @returns {{ src: string, id: string, date: string, type: string, data: Object } | null}
   */
  #buildArchiveEntry(activity) {
    const date = moment(activity.date).tz(this.#timezone).format('YYYY-MM-DD');

    // Validate date
    if (!moment(date, 'YYYY-MM-DD', true).isValid() ||
        moment(date).isBefore('2000-01-01') ||
        moment(date).isAfter(moment().add(1, 'day'))) {
      this.#logger.warn?.('fitsync.invalid_date', {
        date,
        itemId: activity.itemId,
      });
      return null;
    }

    // Generate deterministic ID from itemId
    const id = this.#generateActivityId(activity.itemId);

    // Clone activity and remove GPS to save space
    const data = { ...activity };
    delete data.gps;

    return {
      src: 'garmin',
      id,
      date,
      type: activity.activity,
      data,
    };
  }

  /**
   * Generate deterministic MD5 hash for activity ID
   *
   * @private
   * @param {string} itemId - FitnessSyncer item ID
   * @returns {string} MD5 hash
   */
  #generateActivityId(itemId) {
    return crypto.createHash('md5').update(String(itemId)).digest('hex');
  }

  /**
   * Merge summary data with existing fitness.yml
   *
   * @private
   * @param {string} username - Target user
   * @param {Object} summary - New summary data to merge
   */
  async #mergeSummary(username, summary) {
    // Load existing fitness data
    const existing = await this.#lifelogStore.load(username, 'fitness') || {};

    // Merge new data (overwrite strategy: new data wins)
    for (const [date, data] of Object.entries(summary)) {
      existing[date] = data;
    }

    // Save merged data
    await this.#lifelogStore.save(username, 'fitness', existing);

    this.#logger.debug?.('fitsync.summary.merged', {
      username,
      datesUpdated: Object.keys(summary).length,
    });
  }

  /**
   * Merge archive data with existing archives/fitness_long
   *
   * @private
   * @param {string} username - Target user
   * @param {Object} archive - New archive data to merge
   */
  async #mergeArchive(username, archive) {
    // Load existing archive
    const existing = await this.#lifelogStore.load(username, 'archives/fitness_long') || {};

    // Merge new data (deduplicate by ID)
    for (const [date, activities] of Object.entries(archive)) {
      if (!existing[date]) existing[date] = {};
      
      for (const [id, activity] of Object.entries(activities)) {
        existing[date][id] = activity;
      }
    }

    // Save merged archive
    await this.#lifelogStore.save(username, 'archives/fitness_long', existing);

    this.#logger.debug?.('fitsync.archive.merged', {
      username,
      datesUpdated: Object.keys(archive).length,
    });
  }

  /**
   * Get circuit breaker and harvest status
   *
   * @returns {Object} Status including circuit breaker state
   */
  getStatus() {
    return this.#adapter.getStatus();
  }

  /**
   * Check if harvester is in cooldown state
   *
   * @returns {boolean} True if circuit breaker is open
   */
  isInCooldown() {
    return this.#adapter.isInCooldown();
  }

  /**
   * Get available harvest parameters
   *
   * @returns {Array<Object>} Parameter definitions
   */
  getParams() {
    return [
      {
        name: 'daysBack',
        type: 'number',
        default: 7,
        description: 'Days of history to fetch',
      },
      {
        name: 'sourceKey',
        type: 'string',
        default: 'GarminWellness',
        description: 'FitnessSyncer provider key (e.g., GarminWellness, Strava)',
      },
    ];
  }

  /**
   * Clean error message for logging
   *
   * @private
   * @param {Error} error - Error to clean
   * @returns {string} Cleaned error message
   */
  #cleanErrorMessage(error) {
    if (!error) return 'Unknown error';
    
    // Extract the most relevant error message
    if (error.response?.data?.message) return error.response.data.message;
    if (error.response?.data?.error) return error.response.data.error;
    if (error.message) return error.message;
    
    return String(error);
  }
}

export default FitnessSyncerHarvester;
