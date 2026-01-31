/**
 * WithingsHarvester
 *
 * Fetches weight measurement data from Withings API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - OAuth token refresh with caching
 * - Circuit breaker for rate limiting resilience
 * - Unit conversion (kg to lbs)
 * - Multi-measurement support (weight, body fat, lean mass)
 *
 * @module harvester/fitness/WithingsHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Withings measurement type codes
 */
const MeasureType = {
  WEIGHT_KG: 1,
  FAT_FREE_MASS_KG: 5,
  FAT_MASS_KG: 8,
  FAT_PERCENT: 6,
};

const KG_TO_LBS = 2.20462;

/**
 * Withings weight harvester
 * @implements {IHarvester}
 */
export class WithingsHarvester extends IHarvester {
  #httpClient;
  #lifelogStore;
  #authStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;
  #tokenCache;

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
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!httpClient) {
      throw new InfrastructureError('WithingsHarvester requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }
    if (!lifelogStore) {
      throw new InfrastructureError('WithingsHarvester requires lifelogStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'lifelogStore'
      });
    }

    this.#httpClient = httpClient;
    this.#lifelogStore = lifelogStore;
    this.#authStore = authStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#logger = logger;

    this.#tokenCache = {
      token: null,
      expiresAt: null,
    };

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'withings';
  }

  get category() {
    return HarvesterCategory.FITNESS;
  }

  /**
   * Harvest weight measurements from Withings
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.yearsBack=15] - Years of history to fetch
   * @returns {Promise<{ count: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { yearsBack = 15 } = options;

    // Dev mode bypass - skip API calls during development
    if (process.env.dev) {
      this.#logger?.info?.('withings.harvest.devMode', { message: 'Dev mode - skipping API call' });
      return { skipped: true, reason: 'dev_mode' };
    }

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('withings.harvest.skipped', {
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
      this.#logger.info?.('withings.harvest.start', { username, yearsBack });

      // 1. Refresh access token
      const accessToken = await this.#refreshAccessToken(username);
      if (!accessToken) {
        return { count: 0, status: 'error', reason: 'auth_failed' };
      }

      // 2. Fetch measurements
      const measurements = await this.#fetchMeasurements(accessToken, yearsBack);
      if (!measurements || measurements.length === 0) {
        this.#circuitBreaker.recordSuccess();
        return { count: 0, status: 'success' };
      }

      // 3. Save to lifelog
      await this.#lifelogStore.save(username, 'withings', measurements);

      // Note: Call processWeight(jobId) after harvest to compute weight analytics
      // (interpolation, rolling averages, trendlines, caloric balance)
      // See: backend/_legacy/jobs/weight.mjs for the full implementation

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('withings.harvest.complete', {
        username,
        measurementCount: measurements.length,
      });

      return { count: measurements.length, status: 'success' };

    } catch (error) {
      const statusCode = error.response?.status;
      const isRateLimit = statusCode === 429 ||
                         error.message?.includes('429') ||
                         error.message?.includes('Too Many Requests') ||
                         error.message?.includes('rate limit');

      // Record failure for rate limit errors
      if (isRateLimit) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('withings.harvest.error', {
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
   * Check if harvester is in cooldown state
   * @returns {boolean} True if circuit breaker is open
   */
  isInCooldown() {
    return this.#circuitBreaker?.isOpen?.() ?? false;
  }

  /**
   * Refresh OAuth access token
   * @private
   */
  async #refreshAccessToken(username) {
    const now = moment();

    // Check cache first
    if (this.#tokenCache.token && this.#tokenCache.expiresAt && now.isBefore(this.#tokenCache.expiresAt)) {
      this.#logger.debug?.('withings.auth.cache_hit', { expiresAt: this.#tokenCache.expiresAt.toISOString() });
      return this.#tokenCache.token;
    }

    try {
      const authData = this.#configService?.getUserAuth?.('withings', username) || {};
      const refresh = authData.refresh || authData.refresh_token;

      if (!refresh) {
        this.#logger.error?.('withings.auth.noRefreshToken', { username });
        return null;
      }

      // Get credentials
      const clientId = this.#configService?.getSecret?.('WITHINGS_CLIENT_ID') ||
                       this.#configService?.getSecret?.('WITHINGS_CLIENT');
      const clientSecret = this.#configService?.getSecret?.('WITHINGS_CLIENT_SECRET') ||
                          this.#configService?.getSecret?.('WITHINGS_SECRET');
      const redirectUri = this.#configService?.getSecret?.('WITHINGS_REDIRECT');

      if (!clientId || !clientSecret) {
        this.#logger.error?.('withings.auth.credentials_missing', { message: 'WITHINGS_CLIENT_ID/SECRET missing' });
        return null;
      }

      const params = {
        action: 'requesttoken',
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        redirect_uri: redirectUri,
      };

      const response = await this.#httpClient.post('https://wbsapi.withings.net/v2/oauth2', params);
      const body = response?.data?.body || {};

      if (!body.access_token) {
        this.#logger.error?.('withings.auth.no_access_token', { response: response?.data });
        return null;
      }

      // Cache the token
      const expiresIn = body.expires_in || 3600;
      const tokenBuffer = 60; // Refresh 1 minute before expiry
      this.#tokenCache.token = body.access_token;
      this.#tokenCache.expiresAt = moment().add(Math.max(60, expiresIn - tokenBuffer), 'seconds');

      // Persist new refresh token if provided
      if (body.refresh_token && this.#authStore) {
        const newAuthData = {
          ...authData,
          refresh: body.refresh_token,
          access_token: body.access_token,
          expires_at: this.#tokenCache.expiresAt.toISOString(),
        };
        await this.#authStore.save(username, 'withings', newAuthData);
      }

      this.#logger.info?.('withings.auth.token_refreshed', {
        username,
        expiresAt: this.#tokenCache.expiresAt.toISOString(),
      });

      return this.#tokenCache.token;

    } catch (error) {
      this.#logger.error?.('withings.auth.error', {
        username,
        error: this.#cleanErrorMessage(error),
      });
      this.#tokenCache.token = null;
      this.#tokenCache.expiresAt = null;
      return null;
    }
  }

  /**
   * Fetch measurements from Withings API
   * @private
   */
  async #fetchMeasurements(accessToken, yearsBack) {
    const startdate = Math.floor(Date.now() / 1000) - (yearsBack * 365 * 24 * 60 * 60);
    const enddate = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // Tomorrow

    const params = new URLSearchParams({
      access_token: accessToken,
      startdate: startdate.toString(),
      enddate: enddate.toString(),
    });

    const url = `https://wbsapi.withings.net/measure?action=getmeas&${params.toString()}`;
    const response = await this.#httpClient.get(url);
    const data = response.data;

    if (!data?.body?.measuregrps) {
      return [];
    }

    // Process measurements by timestamp
    const measurementsByTime = {};

    for (const group of data.body.measuregrps) {
      const timestamp = group.date;
      const date = moment.unix(timestamp).tz(this.#timezone).format('YYYY-MM-DD');

      measurementsByTime[timestamp] = {
        time: timestamp,
        date,
      };

      for (const measure of group.measures) {
        const value = this.#round(measure.value * Math.pow(10, measure.unit), 1);

        switch (measure.type) {
          case MeasureType.WEIGHT_KG:
            measurementsByTime[timestamp].lbs = this.#round(value * KG_TO_LBS, 1);
            break;
          case MeasureType.FAT_FREE_MASS_KG:
            measurementsByTime[timestamp].lean_lbs = this.#round(value * KG_TO_LBS, 1);
            break;
          case MeasureType.FAT_MASS_KG:
            measurementsByTime[timestamp].fat_lbs = this.#round(value * KG_TO_LBS, 1);
            break;
          case MeasureType.FAT_PERCENT:
            measurementsByTime[timestamp].fat_percent = this.#round(value, 1);
            break;
        }
      }
    }

    // Convert to array, filter for weight measurements, sort newest first
    const measurements = Object.values(measurementsByTime)
      .filter(m => m.lbs)
      .sort((a, b) => b.time - a.time);

    return measurements;
  }

  /**
   * Round to specified decimal places
   * @private
   */
  #round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
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

export default WithingsHarvester;
