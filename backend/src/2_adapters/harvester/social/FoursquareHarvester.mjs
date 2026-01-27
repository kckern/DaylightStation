/**
 * FoursquareHarvester
 *
 * Fetches user's Foursquare/Swarm check-in history.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Location check-ins with venue, photos, comments
 * - Incremental sync (last 30 days by default)
 * - Full sync option for complete history
 * - OAuth token authentication
 *
 * @module harvester/social/FoursquareHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';

// Foursquare API version date (required param)
const API_VERSION = '20231231';

// Default to fetch last 30 days for incremental updates
const DEFAULT_DAYS_BACK = 30;

/**
 * Foursquare/Swarm check-in harvester
 * @implements {IHarvester}
 */
export class FoursquareHarvester extends IHarvester {
  #httpClient;
  #lifelogStore;
  #authStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for API requests
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.authStore - Store for OAuth tokens
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
      throw new Error('FoursquareHarvester requires httpClient');
    }
    if (!lifelogStore) {
      throw new Error('FoursquareHarvester requires lifelogStore');
    }

    this.#httpClient = httpClient;
    this.#lifelogStore = lifelogStore;
    this.#authStore = authStore;
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
    return 'foursquare';
  }

  get category() {
    return HarvesterCategory.SOCIAL;
  }

  /**
   * Harvest check-ins from Foursquare/Swarm
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {boolean} [options.full=false] - Full sync vs incremental
   * @param {number} [options.days=30] - Days back for incremental sync
   * @returns {Promise<{ count: number, stats: Object, status: string }>}
   */
  async harvest(username, options = {}) {
    const { full = false, days = DEFAULT_DAYS_BACK } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('foursquare.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        count: 0,
        stats: {},
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('foursquare.harvest.start', {
        username,
        mode: full ? 'full' : 'incremental',
        days: full ? 'all' : days,
      });

      // Get OAuth token
      const auth = this.#configService?.getUserAuth?.('foursquare', username) || {};
      const token = auth.token || this.#configService?.getSecret?.('FOURSQUARE_TOKEN');

      if (!token) {
        throw new Error('Foursquare OAuth token not configured');
      }

      // Load existing data for incremental merge
      let existingCheckins = [];
      if (!full) {
        try {
          existingCheckins = await this.#lifelogStore.load(username, 'checkins') || [];
          if (!Array.isArray(existingCheckins)) existingCheckins = [];
        } catch (e) {
          // No existing data
          this.#logger.debug?.('foursquare.no_existing_data', { username });
        }
      }

      // Calculate time window for incremental fetch
      const afterTimestamp = full ? null : moment().subtract(days, 'days').unix();

      // Fetch check-ins with pagination
      const newCheckins = await this.#fetchAllCheckins(token, afterTimestamp);

      // Merge and dedupe: new check-ins take precedence
      const existingById = new Map(existingCheckins.map(c => [c.id, c]));
      for (const checkin of newCheckins) {
        existingById.set(checkin.id, checkin);
      }

      // Convert back to array and sort by timestamp (newest first)
      const mergedCheckins = Array.from(existingById.values())
        .sort((a, b) => b.timestamp - a.timestamp);

      // Save to lifelog
      await this.#lifelogStore.save(username, 'checkins', mergedCheckins);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const stats = {
        total: mergedCheckins.length,
        newFetched: newCheckins.length,
        previousCount: existingCheckins.length,
        uniqueVenues: [...new Set(mergedCheckins.map(c => c.venue?.id).filter(Boolean))].length,
        withPhotos: mergedCheckins.filter(c => c.photos?.length > 0).length,
        withShouts: mergedCheckins.filter(c => c.shout).length,
        categories: [...new Set(mergedCheckins.map(c => c.venue?.category).filter(Boolean))].length,
        dateRange: mergedCheckins.length > 0 ? {
          oldest: mergedCheckins[mergedCheckins.length - 1].date,
          newest: mergedCheckins[0].date,
        } : null,
      };

      this.#logger.info?.('foursquare.harvest.complete', {
        username,
        mode: full ? 'full' : 'incremental',
        ...stats,
      });

      return { count: mergedCheckins.length, stats, status: 'success' };

    } catch (error) {
      const statusCode = error.response?.status;
      const errorDetail = error.response?.data?.meta?.errorDetail;

      // Record failure for rate limits and auth errors
      if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('foursquare.harvest.error', {
        username,
        error: error.message,
        statusCode,
        errorDetail,
        circuitState: this.#circuitBreaker.getStatus().state,
      });

      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Fetch all check-ins with pagination
   * @private
   */
  async #fetchAllCheckins(token, afterTimestamp) {
    const checkins = [];
    let offset = 0;
    const limit = 250; // Max per request
    let hasMore = true;

    while (hasMore) {
      const params = {
        oauth_token: token,
        v: API_VERSION,
        limit: limit,
        offset: offset,
        sort: 'newestfirst',
      };

      // For incremental, use afterTimestamp to limit results
      if (afterTimestamp) {
        params.afterTimestamp = afterTimestamp;
      }

      const response = await this.#httpClient.get(
        'https://api.foursquare.com/v2/users/self/checkins',
        {
          params,
          headers: {
            'User-Agent': 'DaylightStation-Harvester/1.0',
            'Accept': 'application/json',
          },
        }
      );

      const items = response.data?.response?.checkins?.items || [];

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const checkin of items) {
        checkins.push(this.#parseCheckin(checkin));
      }

      offset += items.length;

      // Safety limit to prevent infinite loops
      if (offset >= 10000) {
        this.#logger.warn?.('foursquare.pagination.limit', {
          message: 'Reached 10,000 check-in limit',
          offset,
        });
        hasMore = false;
      }

      // If we got fewer than limit, we've reached the end
      if (items.length < limit) {
        hasMore = false;
      }
    }

    return checkins;
  }

  /**
   * Parse a raw Foursquare checkin into normalized format
   * @private
   */
  #parseCheckin(checkin) {
    const venue = checkin.venue || {};
    const location = venue.location || {};
    const categories = venue.categories || [];
    const primaryCategory = categories.find(c => c.primary) || categories[0];

    return {
      id: checkin.id,
      type: 'checkin',
      createdAt: moment.unix(checkin.createdAt).toISOString(),
      date: moment.unix(checkin.createdAt).tz(this.#timezone).format('YYYY-MM-DD'),
      timestamp: checkin.createdAt,
      timezone: checkin.timeZoneOffset,

      // Venue info
      venue: {
        id: venue.id,
        name: venue.name,
        category: primaryCategory?.name || null,
        categoryIcon: primaryCategory?.icon
          ? `${primaryCategory.icon.prefix}64${primaryCategory.icon.suffix}`
          : null,
        url: venue.url || null,
      },

      // Location
      location: {
        address: location.address || null,
        city: location.city || null,
        state: location.state || null,
        country: location.country || null,
        postalCode: location.postalCode || null,
        lat: location.lat,
        lng: location.lng,
        formattedAddress: location.formattedAddress?.join(', ') || null,
      },

      // Check-in details
      shout: checkin.shout || null,
      photos: (checkin.photos?.items || []).map(photo => ({
        id: photo.id,
        url: `${photo.prefix}original${photo.suffix}`,
        width: photo.width,
        height: photo.height,
      })),

      // Social
      likes: checkin.likes?.count || 0,
      comments: (checkin.comments?.items || []).map(comment => ({
        id: comment.id,
        text: comment.text,
        createdAt: moment.unix(comment.createdAt).toISOString(),
      })),

      // Source app
      source: checkin.source?.name || 'Swarm',

      // Private flag
      private: checkin.private || false,

      // Event if applicable
      event: checkin.event
        ? {
            id: checkin.event.id,
            name: checkin.event.name,
          }
        : null,
    };
  }
}

export default FoursquareHarvester;
