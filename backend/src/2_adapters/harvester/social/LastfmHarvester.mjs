/**
 * LastfmHarvester
 *
 * Fetches user's music scrobbles from Last.fm API.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Incremental scrobble fetching
 * - Pagination support
 * - Deduplication by scrobble ID
 * - Retry logic for API failures
 *
 * @module harvester/social/LastfmHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '../../../0_infrastructure/config/index.mjs';

/**
 * Last.fm scrobble harvester
 * @implements {IHarvester}
 */
export class LastfmHarvester extends IHarvester {
  #httpClient;
  #lifelogStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for API requests
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    httpClient,
    lifelogStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!httpClient) {
      throw new Error('LastfmHarvester requires httpClient');
    }
    if (!lifelogStore) {
      throw new Error('LastfmHarvester requires lifelogStore');
    }

    this.#httpClient = httpClient;
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
    return 'lastfm';
  }

  get category() {
    return HarvesterCategory.SOCIAL;
  }

  /**
   * Harvest scrobbles from Last.fm
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.maxPages=10] - Max pages to fetch
   * @param {boolean} [options.fullSync=false] - Fetch all pages if true
   * @returns {Promise<{ count: number, newFetched: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { maxPages = 10, fullSync = false } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('lastfm.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        count: 0,
        newFetched: 0,
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('lastfm.harvest.start', { username, maxPages, fullSync });

      // Get auth
      const auth = this.#configService?.getUserAuth?.('lastfm', username) || {};
      const lastfmUser = auth.username || configService.getSecret('LAST_FM_USER');
      const apiKey = this.#resolveApiKey(auth);

      if (!apiKey) {
        throw new Error('Last.fm API key not configured');
      }
      if (!lastfmUser) {
        throw new Error('Last.fm username not configured');
      }

      // Load existing scrobbles
      const existingScrobbles = await this.#lifelogStore.load(username, 'lastfm') || [];
      const existingSet = new Set(existingScrobbles.map(s => s.id));

      // Fetch new scrobbles
      const newScrobbles = [];
      let page = 1;
      const pageLimit = fullSync ? 50 : maxPages;
      let hasMore = true;

      while (hasMore && page <= pageLimit) {
        const tracks = await this.#fetchPage(apiKey, lastfmUser, page);

        if (!tracks || tracks.length === 0) {
          hasMore = false;
          break;
        }

        const parsed = tracks
          .map(track => this.#parseScrobble(track))
          .filter(s => s !== null && !existingSet.has(s.id));

        newScrobbles.push(...parsed);
        parsed.forEach(s => existingSet.add(s.id));

        // Log progress
        if (page % 10 === 0) {
          this.#logger.info?.('lastfm.harvest.progress', {
            lastfmUser,
            page,
            fetchedSoFar: newScrobbles.length,
          });
        }

        page++;
        await this.#delay(100); // Rate limiting
      }

      // Merge and sort (newest first)
      const allScrobbles = [...existingScrobbles, ...newScrobbles]
        .sort((a, b) => b.timestamp - a.timestamp);

      // Save to lifelog
      await this.#lifelogStore.save(username, 'lastfm', allScrobbles);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('lastfm.harvest.complete', {
        username,
        lastfmUser,
        total: allScrobbles.length,
        newFetched: newScrobbles.length,
        previousCount: existingScrobbles.length,
      });

      return {
        count: allScrobbles.length,
        newFetched: newScrobbles.length,
        status: 'success',
      };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429 || statusCode === 401 || statusCode === 403) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('lastfm.harvest.error', {
        username,
        error: error.message,
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
   * Resolve API key from various sources
   * @private
   */
  #resolveApiKey(auth) {
    const candidates = [
      'LAST_FM_API_KEY',
      'LASTFM_API_KEY',
      'LASTFM_APIKEY',
    ];

    // Check injected configService first
    for (const key of candidates) {
      const val = this.#configService?.getSecret?.(key);
      if (val) return val;
    }

    // Fallback to global configService
    for (const key of candidates) {
      const val = configService?.isReady?.() ? configService.getSecret(key) : null;
      if (val) return val;
    }

    // Check auth
    if (auth?.key) return auth.key;

    return null;
  }

  /**
   * Fetch a page of scrobbles
   * @private
   */
  async #fetchPage(apiKey, lastfmUser, page) {
    const params = {
      api_key: apiKey,
      user: lastfmUser,
      limit: 200,
      method: 'user.getRecentTracks',
      page,
      format: 'json',
    };

    let retries = 3;
    while (retries > 0) {
      try {
        const response = await this.#httpClient.get(
          `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams(params).toString()}`,
          {
            headers: {
              'User-Agent': 'DaylightStation-Harvester/1.0',
              'Accept': 'application/json',
            },
            timeout: 10000,
          }
        );

        return response.data?.recenttracks?.track || [];

      } catch (error) {
        retries--;
        if (retries === 0) throw error;

        const waitTime = (4 - retries) * 2000;
        this.#logger.warn?.('lastfm.api.retry', {
          page,
          retriesLeft: retries,
          waitTime,
          error: error.message,
        });
        await this.#delay(waitTime);
      }
    }

    return [];
  }

  /**
   * Parse a scrobble from API response
   * @private
   */
  #parseScrobble(track) {
    // Skip "now playing" tracks
    if (!track.date) return null;

    const timestamp = parseInt(track.date.uts);

    return {
      id: `${track.date.uts}-${track.artist['#text']}-${track.name}`.replace(/[^a-z0-9-]/gi, '_'),
      unix: timestamp,
      date: track.date['#text'],
      timestamp,
      artist: track.artist['#text'],
      album: track.album['#text'],
      title: track.name,
      mbid: track.mbid || null,
      url: track.url || null,
      image: track.image?.find(img => img.size === 'large')?.['#text'] || null,
    };
  }

  /**
   * Delay helper
   * @private
   */
  #delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default LastfmHarvester;
