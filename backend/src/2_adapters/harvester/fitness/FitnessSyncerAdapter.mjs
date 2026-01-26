/**
 * FitnessSyncerAdapter
 *
 * Adapter for FitnessSyncer OAuth token, source management, and activity harvesting.
 * Handles token caching, refresh, and circuit breaker resilience.
 *
 * Features:
 * - OAuth token refresh with caching
 * - In-memory and persistent token storage
 * - Circuit breaker for rate limiting resilience
 * - 5-minute buffer before token expiry
 * - Source ID lookup and caching
 * - Activity fetching with date range filtering
 * - Harvest interface for standardized activity transformation
 *
 * @module harvester/fitness/FitnessSyncerAdapter
 */

import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { nowTs24 } from '../../../0_system/utils/index.mjs';

/**
 * Token buffer in milliseconds (5 minutes)
 * Refresh tokens 5 minutes before actual expiry
 */
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

/**
 * FitnessSyncer OAuth adapter
 */
export class FitnessSyncerAdapter {
  #httpClient;
  #authStore;
  #logger;
  #clientId;
  #clientSecret;
  #circuitBreaker;
  #tokenCache;
  #sourceCache;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client with get/post methods
   * @param {Object} config.authStore - Auth store with get/set methods
   * @param {Object} [config.logger] - Logger instance
   * @param {string} [config.clientId] - OAuth client ID (can also come from authStore)
   * @param {string} [config.clientSecret] - OAuth client secret (can also come from authStore)
   * @param {number} [config.cooldownMinutes=5] - Base cooldown in minutes for circuit breaker
   */
  constructor({
    httpClient,
    authStore,
    logger = console,
    clientId,
    clientSecret,
    cooldownMinutes = 5,
  }) {
    if (!httpClient) {
      throw new Error('FitnessSyncerAdapter requires httpClient');
    }
    if (!authStore) {
      throw new Error('FitnessSyncerAdapter requires authStore');
    }

    this.#httpClient = httpClient;
    this.#authStore = authStore;
    this.#logger = logger;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;

    // In-memory token cache
    this.#tokenCache = {
      token: null,
      expiresAt: null,
    };

    // Source ID cache (providerKey -> sourceId)
    this.#sourceCache = new Map();

    // Circuit breaker for rate limiting resilience
    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: cooldownMinutes * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000, // 2 hours max
      logger: logger,
    });
  }

  /**
   * Get a valid access token, refreshing if necessary
   *
   * @returns {Promise<string|null>} Access token or null if unavailable
   */
  async getAccessToken() {
    const now = Date.now();

    // Check in-memory cache first
    if (this.#tokenCache.token && this.#tokenCache.expiresAt && now < this.#tokenCache.expiresAt) {
      this.#logger.debug?.('fitsync.auth.memory_cache_hit', {
        expiresAt: new Date(this.#tokenCache.expiresAt).toISOString(),
      });
      return this.#tokenCache.token;
    }

    // Check persistent store
    const authData = await this.#authStore.get('fitsync');

    // Check if stored token is still valid (with buffer)
    if (authData?.access_token && authData.expires_at) {
      const expiresAt = typeof authData.expires_at === 'number'
        ? authData.expires_at
        : new Date(authData.expires_at).getTime();

      if (now < expiresAt - TOKEN_BUFFER_MS) {
        // Token is still valid, cache it in memory
        this.#tokenCache.token = authData.access_token;
        this.#tokenCache.expiresAt = expiresAt - TOKEN_BUFFER_MS;

        this.#logger.debug?.('fitsync.auth.store_cache_hit', {
          expiresAt: new Date(expiresAt).toISOString(),
        });
        return authData.access_token;
      }
    }

    // Need to refresh token
    return this.#refreshToken(authData);
  }

  /**
   * Refresh the OAuth access token
   * @private
   */
  async #refreshToken(authData) {
    const refreshToken = authData?.refresh || authData?.refresh_token;

    if (!refreshToken) {
      this.#logger.error?.('fitsync.auth.no_refresh_token', {
        message: 'No refresh token available',
      });
      return null;
    }

    // Get credentials - prefer constructor params, fall back to stored
    const clientId = this.#clientId || authData?.client_id;
    const clientSecret = this.#clientSecret || authData?.client_secret;

    if (!clientId || !clientSecret) {
      this.#logger.error?.('fitsync.auth.credentials_missing', {
        message: 'Client ID or secret not configured',
      });
      return null;
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await this.#httpClient.post(
        'https://www.fitnesssyncer.com/api/oauth/access_token',
        params,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const data = response.data;

      if (!data?.access_token) {
        this.#logger.error?.('fitsync.auth.no_access_token', {
          response: data,
        });
        return null;
      }

      // Calculate expiry with buffer
      const expiresIn = data.expires_in || 3600;
      const expiresAt = Date.now() + (expiresIn - 300) * 1000; // 5-minute buffer in seconds

      // Update in-memory cache
      this.#tokenCache.token = data.access_token;
      this.#tokenCache.expiresAt = expiresAt;

      // Persist to auth store
      const newAuthData = {
        ...authData,
        access_token: data.access_token,
        refresh: data.refresh_token || refreshToken,
        expires_at: expiresAt,
        client_id: clientId,
        client_secret: clientSecret,
      };

      await this.#authStore.set('fitsync', newAuthData);

      this.#logger.info?.('fitsync.auth.token_refreshed', {
        expiresAt: new Date(expiresAt).toISOString(),
      });

      return data.access_token;

    } catch (error) {
      // Clear cached token on failure
      this.#tokenCache.token = null;
      this.#tokenCache.expiresAt = null;

      // Record failure for rate limiting
      const statusCode = error.response?.status;
      if (statusCode === 429) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('fitsync.auth.token_refresh_failed', {
        error: this.#cleanErrorMessage(error),
        statusCode,
      });

      return null;
    }
  }

  /**
   * Check if circuit breaker is in cooldown
   *
   * @returns {boolean} True if in cooldown
   */
  isInCooldown() {
    return this.#circuitBreaker.isOpen();
  }

  /**
   * Get cooldown status details
   *
   * @returns {{ inCooldown: boolean, remainingMs: number, remainingMins: number } | null}
   */
  getCooldownStatus() {
    return this.#circuitBreaker.getCooldownStatus();
  }

  /**
   * Record a failure for the circuit breaker
   *
   * @param {Error} error - The error that occurred
   */
  recordFailure(error) {
    this.#circuitBreaker.recordFailure(error);
  }

  /**
   * Record a success and reset the circuit breaker
   */
  recordSuccess() {
    this.#circuitBreaker.recordSuccess();
  }

  /**
   * Get circuit breaker status
   *
   * @returns {Object} Status including state, failures, etc.
   */
  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Get source ID for a provider
   *
   * Returns cached source ID if available, otherwise fetches from API.
   * Caches all sources from response for subsequent lookups.
   *
   * @param {string} providerKey - Provider key (e.g., 'GarminWellness', 'Strava')
   * @returns {Promise<string|null>} Source ID or null if not found
   */
  async getSourceId(providerKey) {
    // Check cache first
    if (this.#sourceCache.has(providerKey)) {
      return this.#sourceCache.get(providerKey);
    }

    // Get access token
    const token = await this.getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const response = await this.#httpClient.get(
        'https://www.fitnesssyncer.com/api/sources',
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const items = response.data?.items;
      if (!items || !Array.isArray(items)) {
        return null;
      }

      // Cache all sources from response
      for (const source of items) {
        if (source.providerType && source.id) {
          this.#sourceCache.set(source.providerType, source.id);
        }
      }

      // Return the requested source (may be null if not found)
      return this.#sourceCache.get(providerKey) ?? null;

    } catch (error) {
      this.#logger.error?.('fitsync.sources.fetch_failed', {
        error: this.#cleanErrorMessage(error),
        providerKey,
      });
      return null;
    }
  }

  /**
   * Manually set/override source ID in cache
   *
   * Useful for testing and manual configuration.
   *
   * @param {string} providerKey - Provider key (e.g., 'GarminWellness', 'Strava')
   * @param {string} sourceId - Source ID to cache
   */
  setSourceId(providerKey, sourceId) {
    this.#sourceCache.set(providerKey, sourceId);
  }

  /**
   * Fetch activities from FitnessSyncer API
   *
   * @param {Object} options - Fetch options
   * @param {number} [options.daysBack=7] - Number of days back to fetch
   * @param {string} [options.sourceKey='GarminWellness'] - Provider key to fetch activities from
   * @returns {Promise<Array>} Raw activity array from API
   * @throws {Error} If circuit breaker is in cooldown
   * @throws {Error} If no access token is available
   * @throws {Error} If source ID cannot be resolved
   */
  async getActivities({ daysBack = 7, sourceKey = 'GarminWellness' } = {}) {
    // Check circuit breaker first
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      throw new Error(
        `Circuit breaker is in cooldown (${cooldown?.remainingMins} minutes remaining)`
      );
    }

    try {
      // Get access token
      const token = await this.getAccessToken();
      if (!token) {
        throw new Error('No access token available');
      }

      // Get source ID for provider
      const sourceId = await this.getSourceId(sourceKey);
      if (!sourceId) {
        throw new Error(`Could not resolve source ID for ${sourceKey}`);
      }

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Fetch activities from API
      const url = `https://www.fitnesssyncer.com/api/activities?sourceId=${sourceId}&startDate=${startDateStr}&endDate=${endDateStr}`;

      const response = await this.#httpClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const activities = response.data?.items || [];

      // Record success
      this.#circuitBreaker.recordSuccess();

      this.#logger.debug?.('fitsync.activities.fetched', {
        count: activities.length,
        sourceKey,
        daysBack,
      });

      return activities;

    } catch (error) {
      // Record failure for circuit breaker
      this.#circuitBreaker.recordFailure(error);

      this.#logger.error?.('fitsync.activities.fetch_failed', {
        error: this.#cleanErrorMessage(error),
        sourceKey,
        daysBack,
      });

      throw error;
    }
  }

  /**
   * Harvest activities and transform to standardized format
   *
   * Implements IHarvester interface pattern.
   *
   * @param {Object} options - Harvest options
   * @param {string} [options.jobId] - Job ID for logging
   * @param {number} [options.daysBack=7] - Number of days back to fetch
   * @returns {Promise<Object>} Harvest result with items and metadata
   */
  async harvest({ jobId, daysBack = 7 } = {}) {
    // Check circuit breaker first - return skipped status instead of throwing
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('fitsync.harvest.skipped', {
        jobId,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      // Fetch raw activities
      const activities = await this.getActivities({ daysBack });

      // Transform to standardized format
      const items = activities.map((activity) => ({
        source: 'fitsync',
        externalId: activity.id,
        startTime: activity.startTime,
        type: activity.type,
        title: activity.name || activity.type,
        duration: activity.duration,
        calories: activity.calories,
        distance: activity.distance,
        avgHr: activity.avgHeartRate,
        maxHr: activity.maxHeartRate,
        raw: activity,
      }));

      this.#logger.info?.('fitsync.harvest.complete', {
        jobId,
        count: items.length,
        daysBack,
      });

      return {
        items,
        metadata: {
          source: 'fitsync',
          harvestedAt: nowTs24(),
          daysBack,
        },
      };

    } catch (error) {
      this.#logger.error?.('fitsync.harvest.failed', {
        jobId,
        error: this.#cleanErrorMessage(error),
      });

      return {
        status: 'error',
        error: this.#cleanErrorMessage(error),
      };
    }
  }

  /**
   * Extract clean error message from error object
   * @private
   */
  #cleanErrorMessage(error) {
    return FitnessSyncerAdapter.cleanErrorMessage(error);
  }

  /**
   * Extract clean error message from error object
   *
   * Static version for external use and testing.
   * Handles HTML error responses, extracts meaningful text,
   * and truncates long messages.
   *
   * @param {Error|string|*} error - Error object, string, or any value
   * @returns {string} Cleaned error message, truncated to 200 chars
   * @static
   */
  static cleanErrorMessage(error) {
    const errorStr = error?.message || String(error);

    // Check for ERROR code pattern (e.g., "ERROR: (429), TooManyRequests")
    const codeMatch = errorStr.match(/ERROR:\s*\((\d+)\),\s*([^,"]+)/);
    if (codeMatch) {
      const [, code, type] = codeMatch;
      return `HTTP ${code} ${type}`;
    }

    // Check for HTML in error message
    if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html') || errorStr.includes('<body')) {
      // Try to extract text from common tags
      const extracted = [];

      // Extract from <title>
      const titleMatch = errorStr.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        extracted.push(titleMatch[1].trim());
      }

      // Extract from <h1>
      const h1Match = errorStr.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match && h1Match[1]) {
        extracted.push(h1Match[1].trim());
      }

      // Extract from <p>
      const pMatches = errorStr.matchAll(/<p[^>]*>([^<]+)<\/p>/gi);
      for (const match of pMatches) {
        if (match[1]) {
          extracted.push(match[1].trim());
        }
      }

      // If we found structured content, use it
      if (extracted.length > 0) {
        const result = extracted.join(' - ');
        return result.length > 200 ? result.substring(0, 200) + '...' : result;
      }

      // Fallback: strip all HTML tags
      const stripped = errorStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return stripped.length > 200 ? stripped.substring(0, 200) + '...' : stripped;
    }

    return errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr;
  }
}

export default FitnessSyncerAdapter;
