/**
 * GarminHarvester
 *
 * Fetches activity data from Garmin Connect API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * @module harvester/fitness/GarminHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';

/**
 * Garmin activity harvester
 * @implements {IHarvester}
 */
export class GarminHarvester extends IHarvester {
  #garminClientFactory;
  #lifelogStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Function} config.garminClientFactory - Factory function (username) => GarminConnect client
   * @param {Object} config.lifelogStore - Store for reading/writing lifelog YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    garminClientFactory,
    lifelogStore,
    configService,
    timezone = process.env.TZ || 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!garminClientFactory) {
      throw new Error('GarminHarvester requires garminClientFactory');
    }
    if (!lifelogStore) {
      throw new Error('GarminHarvester requires lifelogStore');
    }

    this.#garminClientFactory = garminClientFactory;
    this.#lifelogStore = lifelogStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'garmin';
  }

  get category() {
    return HarvesterCategory.FITNESS;
  }

  /**
   * Harvest activities from Garmin Connect
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.limit=200] - Number of activities to fetch
   * @returns {Promise<{ count: number, status: string, dateCount?: number }>}
   */
  async harvest(username, options = {}) {
    const { limit = 200 } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('garmin.harvest.skipped', {
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
      this.#logger.info?.('garmin.harvest.start', { username, limit });

      // 1. Get Garmin client and login
      const client = await this.#getAuthenticatedClient(username);

      // 2. Fetch activities from API
      const activities = await client.getActivities(0, limit);

      if (!activities || activities.length === 0) {
        this.#logger.info?.('garmin.harvest.empty', { username });
        this.#circuitBreaker.recordSuccess();
        return { count: 0, status: 'success', dateCount: 0 };
      }

      // 3. Transform to simplified format
      const simplified = activities.map((a) => this.#simplifyActivity(a));

      // 4. Aggregate by date
      const byDate = this.#aggregateByDate(simplified);

      // 5. Merge with existing data
      const existing = await this.#lifelogStore.load(username, 'garmin') || {};
      const merged = this.#mergeAndSort({ ...existing, ...byDate });

      // 6. Save to lifelog
      await this.#lifelogStore.save(username, 'garmin', merged);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const dateCount = Object.keys(byDate).length;
      this.#logger.info?.('garmin.harvest.complete', {
        username,
        activityCount: activities.length,
        dateCount,
      });

      return { count: activities.length, status: 'success', dateCount };

    } catch (error) {
      this.#circuitBreaker.recordFailure(error);
      this.#logger.error?.('garmin.harvest.error', {
        username,
        error: this.#cleanErrorMessage(error),
        circuitState: this.#circuitBreaker.getStatus().state,
      });
      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Get authenticated Garmin client
   * @private
   */
  async #getAuthenticatedClient(username) {
    const client = this.#garminClientFactory(username);
    await client.login();
    return client;
  }

  /**
   * Simplify raw Garmin activity to essential fields
   * @private
   */
  #simplifyActivity(activity) {
    const date = moment
      .tz(activity.startTimeLocal, this.#timezone)
      .format('YYYY-MM-DD');

    const simplified = {
      date,
      activityId: activity.activityId,
      activityName: activity.activityName,
    };

    // Only include non-zero/non-null fields
    if (activity.distance) simplified.distance = activity.distance;
    if (activity.duration) simplified.duration = Math.round(activity.duration / 60);
    if (activity.movingDuration) simplified.movingDuration = Math.round(activity.movingDuration / 60);
    if (activity.averageSpeed) simplified.averageSpeed = activity.averageSpeed;
    if (activity.calories) simplified.calories = activity.calories;
    if (activity.bmrCalories) simplified.bmrCalories = activity.bmrCalories;
    if (activity.averageHR) simplified.averageHR = activity.averageHR;
    if (activity.maxHR) simplified.maxHR = activity.maxHR;
    if (activity.steps) simplified.steps = activity.steps;

    // HR zones (only if present)
    if (activity.hrTimeInZone_1 !== undefined) {
      simplified.hrZones = [
        Math.round((activity.hrTimeInZone_1 || 0) / 60),
        Math.round((activity.hrTimeInZone_2 || 0) / 60),
        Math.round((activity.hrTimeInZone_3 || 0) / 60),
        Math.round((activity.hrTimeInZone_4 || 0) / 60),
        Math.round((activity.hrTimeInZone_5 || 0) / 60),
      ];
    }

    // Exercise sets (only if present)
    if (activity.summarizedExerciseSets?.length > 0) {
      simplified.sets = activity.summarizedExerciseSets.map((set) => {
        const minutes = Math.round((set.duration || 0) / 1000 / 60);
        const category = (set.category || 'unknown')
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace('unknown', 'active motion');
        return `${minutes}m of ${category} (${set.reps} reps in ${set.sets} sets)`;
      });
      if (activity.totalSets) simplified.totalSets = activity.totalSets;
      if (activity.totalReps) simplified.totalReps = activity.totalReps;
    }

    return simplified;
  }

  /**
   * Aggregate activities by date
   * @private
   */
  #aggregateByDate(activities) {
    const byDate = {};

    for (const activity of activities) {
      const { date } = activity;
      if (!date) continue;

      if (!byDate[date]) {
        byDate[date] = [];
      }
      byDate[date].push(activity);
    }

    return byDate;
  }

  /**
   * Merge and sort date-keyed data (newest first)
   * @private
   */
  #mergeAndSort(data) {
    return Object.keys(data)
      .filter((key) => moment(key, 'YYYY-MM-DD', true).isValid())
      .sort()
      .reverse()
      .reduce((obj, key) => {
        obj[key] = data[key];
        return obj;
      }, {});
  }

  /**
   * Extract clean error message from HTML error responses
   * @private
   */
  #cleanErrorMessage(error) {
    const errorStr = error?.message || String(error);

    // Check for HTML in error message
    if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html')) {
      const codeMatch = errorStr.match(/ERROR:\s*\((\d+)\),\s*([^,"]+)/);
      if (codeMatch) {
        const [, code, type] = codeMatch;
        const titleMatch = errorStr.match(/<title>([^<]+)<\/title>/);
        const h2Match = errorStr.match(/<h2[^>]*>([^<]+)<\/h2>/);

        const parts = [`HTTP ${code} ${type}`];
        if (h2Match?.[1]) parts.push(h2Match[1]);
        if (titleMatch?.[1]) parts.push(titleMatch[1]);

        return parts.join(' - ');
      }
    }

    // Truncate long messages
    return errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr;
  }
}

export default GarminHarvester;
