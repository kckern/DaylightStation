/**
 * StravaHarvester
 *
 * Fetches activity data from Strava API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - OAuth token refresh
 * - Paginated activity fetching
 * - Heart rate stream fetching with rate limiting
 * - Activity archiving (full data)
 * - Summary generation (lightweight)
 *
 * @module harvester/fitness/StravaHarvester
 */

import moment from 'moment-timezone';
import crypto from 'crypto';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '../../../0_infrastructure/config/index.mjs';

const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');

/**
 * Strava activity harvester
 * @implements {IHarvester}
 */
export class StravaHarvester extends IHarvester {
  #stravaClient;
  #lifelogStore;
  #authStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;
  #rateLimitDelayMs;

  /**
   * @param {Object} config
   * @param {Object} config.stravaClient - Strava API client { refreshToken, getActivities, getActivityStreams }
   * @param {Object} config.lifelogStore - Store for reading/writing lifelog YAML
   * @param {Object} config.authStore - Store for reading/writing auth tokens
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {number} [config.rateLimitDelayMs=5000] - Delay between stream fetches
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    stravaClient,
    lifelogStore,
    authStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    rateLimitDelayMs = 5000,
    logger = console,
  }) {
    super();

    if (!stravaClient) {
      throw new Error('StravaHarvester requires stravaClient');
    }
    if (!lifelogStore) {
      throw new Error('StravaHarvester requires lifelogStore');
    }

    this.#stravaClient = stravaClient;
    this.#lifelogStore = lifelogStore;
    this.#authStore = authStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#rateLimitDelayMs = rateLimitDelayMs;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'strava';
  }

  get category() {
    return HarvesterCategory.FITNESS;
  }

  /**
   * Harvest activities from Strava
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.daysBack=90] - Days of history to fetch
   * @param {string} [options.backfillSince] - Override start date (YYYY-MM-DD)
   * @returns {Promise<{ count: number, status: string, dateCount?: number }>}
   */
  async harvest(username, options = {}) {
    const { daysBack = 90, backfillSince } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('strava.harvest.skipped', {
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
      // Calculate effective days back
      let effectiveDaysBack = daysBack;
      if (backfillSince) {
        const bfMoment = moment(backfillSince, 'YYYY-MM-DD', true);
        if (bfMoment.isValid()) {
          const diffDays = Math.max(1, moment().startOf('day').diff(bfMoment.startOf('day'), 'days') + 1);
          effectiveDaysBack = Math.max(effectiveDaysBack, diffDays);
          this.#logger.info?.('strava.harvest.backfill', { username, since: backfillSince, daysBack: effectiveDaysBack });
        }
      }

      this.#logger.info?.('strava.harvest.start', { username, daysBack: effectiveDaysBack });

      // 1. Refresh access token
      const tokenValid = await this.#refreshAccessToken(username);
      if (!tokenValid) {
        return { count: 0, status: 'error', reason: 'auth_failed' };
      }

      // 2. Fetch activities
      const activities = await this.#fetchActivities(username, effectiveDaysBack);
      if (!activities || activities.length === 0) {
        this.#circuitBreaker.recordSuccess();
        return { count: 0, status: 'success', dateCount: 0 };
      }

      // 3. Enrich with heart rate data
      const enrichedActivities = await this.#enrichWithHeartRate(username, activities);

      // 4. Save to archives (full data)
      await this.#saveToArchives(username, enrichedActivities);

      // 5. Generate and save summary
      const summary = await this.#generateAndSaveSummary(username, enrichedActivities);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const dateCount = Object.keys(summary).length;
      this.#logger.info?.('strava.harvest.complete', {
        username,
        activityCount: enrichedActivities.length,
        dateCount,
      });

      return { count: enrichedActivities.length, status: 'success', dateCount };

    } catch (error) {
      const statusCode = error.response?.status;

      // Record failure for rate limit (429) or auth errors (401)
      if (statusCode === 429 || statusCode === 401) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('strava.harvest.error', {
        username,
        error: this.#cleanErrorMessage(error),
        statusCode,
        circuitState: this.#circuitBreaker.getStatus().state,
      });

      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Generate reauthorization URL for OAuth flow
   * Migrated from: strava.mjs:159-165
   * @param {Object} [options] - Options
   * @param {string} [options.redirectUri] - OAuth callback URL
   * @returns {Object} Object with authorization URL
   */
  reauthSequence(options = {}) {
    const clientId = this.#configService?.getSecret?.('STRAVA_CLIENT_ID') ||
                     configService.getSecret('STRAVA_CLIENT_ID');
    const defaultRedirectUri = this.#configService?.getSecret?.('STRAVA_URL') ||
                               configService.getSecret('STRAVA_URL') ||
                               'http://localhost:3000/api/auth/strava/callback';
    const redirectUri = options.redirectUri || defaultRedirectUri;

    const url = `https://www.strava.com/oauth/authorize?` +
      `client_id=${clientId}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `approval_prompt=force&` +
      `scope=read,activity:read_all`;

    return { url };
  }

  /**
   * Refresh OAuth access token
   * @private
   */
  async #refreshAccessToken(username) {
    try {
      const authData = this.#configService?.getUserAuth?.('strava', username) || {};
      const refreshToken = authData.refresh;

      if (!refreshToken) {
        this.#logger.error?.('strava.auth.noRefreshToken', { username });
        return false;
      }

      const tokenData = await this.#stravaClient.refreshToken(refreshToken);

      if (tokenData && this.#authStore) {
        const newAuthData = {
          ...authData,
          refresh: tokenData.refresh_token || refreshToken,
          access_token: tokenData.access_token,
          expires_at: tokenData.expires_at,
        };
        await this.#authStore.save(username, 'strava', newAuthData);
      }

      return true;
    } catch (error) {
      this.#logger.error?.('strava.auth.error', {
        username,
        error: this.#cleanErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Fetch activities with pagination
   * @private
   */
  async #fetchActivities(username, daysBack) {
    const activities = [];
    let page = 1;
    const perPage = 100;
    const after = moment().subtract(daysBack, 'days').startOf('day').unix();
    const before = moment().startOf('day').unix();

    while (true) {
      const response = await this.#stravaClient.getActivities({ before, after, page, perPage });

      if (!response || response.length === 0) break;

      activities.push(...response);

      if (response.length < perPage) break;
      page++;
    }

    return activities;
  }

  /**
   * Enrich activities with heart rate stream data
   * @private
   */
  async #enrichWithHeartRate(username, activities) {
    const enriched = [];

    for (const activity of activities) {
      if (!activity?.id) continue;

      const date = moment(activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const typeRaw = activity.type || activity.sport_type || 'activity';
      const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';

      // Virtual activities don't have real HR data
      if (activity.type === 'VirtualRide' || activity.type === 'VirtualRun') {
        activity.heartRateOverTime = [9];
        enriched.push(activity);
        continue;
      }

      // Check archive for existing HR data
      const archiveName = `${date}_${safeType}_${activity.id}`;
      const archived = await this.#lifelogStore.load(username, `archives/strava/${archiveName}`);
      if (archived?.data?.heartRateOverTime) {
        enriched.push(archived.data);
        continue;
      }

      // Fetch HR stream with rate limiting
      try {
        await this.#delay(this.#rateLimitDelayMs);

        const hrStream = await this.#stravaClient.getActivityStreams(activity.id, ['heartrate']);
        if (hrStream?.heartrate?.data) {
          activity.heartRateOverTime = hrStream.heartrate.data;
        } else {
          activity.heartRateOverTime = [0];
        }
      } catch (error) {
        this.#logger.warn?.('strava.heartrate.error', {
          activityId: activity.id,
          error: this.#cleanErrorMessage(error),
        });
        activity.heartRateOverTime = [1];

        // Re-throw rate limit errors
        if (error.response?.status === 429) {
          throw error;
        }
      }

      enriched.push(activity);
    }

    return enriched;
  }

  /**
   * Save full activity data to archives
   * @private
   */
  async #saveToArchives(username, activities) {
    for (const activity of activities) {
      if (!activity?.id) continue;

      const date = moment(activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const typeRaw = activity.type || activity.sport_type || 'activity';
      const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';

      const archiveData = {
        id: activity.id,
        date,
        type: safeType,
        src: 'strava',
        data: activity,
      };

      const archiveName = `${date}_${safeType}_${activity.id}`;
      await this.#lifelogStore.save(username, `archives/strava/${archiveName}`, archiveData);
    }
  }

  /**
   * Generate summary and save to lifelog
   * @private
   */
  async #generateAndSaveSummary(username, activities) {
    // Load existing summary
    const existingSummary = await this.#lifelogStore.load(username, 'strava') || {};

    // Clean up legacy data
    const cleanedSummary = this.#cleanLegacyData(existingSummary);

    // Add new activities
    for (const activity of activities) {
      if (!activity?.id) continue;

      const date = moment(activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const typeRaw = activity.type || activity.sport_type || 'activity';
      const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';

      if (!cleanedSummary[date]) {
        cleanedSummary[date] = [];
      }

      const summaryObj = this.#createSummaryObject(activity, safeType);

      // Update or add
      const existingIndex = cleanedSummary[date].findIndex((a) => a.id === summaryObj.id);
      if (existingIndex >= 0) {
        cleanedSummary[date][existingIndex] = summaryObj;
      } else {
        cleanedSummary[date].push(summaryObj);
      }
    }

    // Sort by date (newest first)
    const sortedSummary = this.#sortByDate(cleanedSummary);

    // Save
    await this.#lifelogStore.save(username, 'strava', sortedSummary);

    return sortedSummary;
  }

  /**
   * Create lightweight summary object
   * @private
   */
  #createSummaryObject(activity, type) {
    const obj = {
      id: activity.id,
    };

    if (activity.name) obj.title = activity.name;
    obj.type = type;
    if (activity.start_date) {
      obj.startTime = moment(activity.start_date).tz(this.#timezone).format('hh:mm a');
    }
    if (activity.distance) obj.distance = parseFloat(activity.distance.toFixed(2));
    if (activity.moving_time) obj.minutes = parseFloat((activity.moving_time / 60).toFixed(2));
    if (activity.calories || activity.kilojoules) {
      obj.calories = activity.calories || activity.kilojoules;
    }
    if (activity.average_heartrate) {
      obj.avgHeartrate = parseFloat(activity.average_heartrate.toFixed(2));
    }
    if (activity.max_heartrate) {
      obj.maxHeartrate = parseFloat(activity.max_heartrate.toFixed(2));
    }
    if (activity.suffer_score) {
      obj.suffer_score = parseFloat(activity.suffer_score.toFixed(2));
    }
    if (activity.device_name) obj.device_name = activity.device_name;

    return obj;
  }

  /**
   * Clean legacy data from summary
   * @private
   */
  #cleanLegacyData(summary) {
    const cleaned = { ...summary };

    Object.keys(cleaned).forEach((date) => {
      if (Array.isArray(cleaned[date])) {
        cleaned[date] = cleaned[date].filter((a) => a.id && !a.heartRateOverTime);
        if (cleaned[date].length === 0) {
          delete cleaned[date];
        }
      }
    });

    return cleaned;
  }

  /**
   * Sort summary by date (newest first)
   * @private
   */
  #sortByDate(summary) {
    const sortedDates = Object.keys(summary).sort((a, b) => new Date(b) - new Date(a));
    const sorted = {};

    sortedDates.forEach((date) => {
      if (summary[date].length > 0) {
        sorted[date] = summary[date];
      }
    });

    return sorted;
  }

  /**
   * Delay helper for rate limiting
   * @private
   */
  #delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract clean error message from HTML error responses
   * @private
   */
  #cleanErrorMessage(error) {
    const errorStr = error?.message || String(error);

    if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html')) {
      const codeMatch = errorStr.match(/ERROR:\s*\((\d+)\),\s*([^,"]+)/);
      if (codeMatch) {
        const [, code, type] = codeMatch;
        return `HTTP ${code} ${type}`;
      }
    }

    return errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr;
  }
}

export default StravaHarvester;
