/**
 * LetterboxdHarvester
 *
 * Fetches user's movie diary from Letterboxd via RSS feed.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - RSS feed parsing for watched movies
 * - Rating extraction
 * - TMDB movie ID extraction
 *
 * @module harvester/social/LetterboxdHarvester
 */

import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Letterboxd movie diary harvester
 * @implements {IHarvester}
 */
export class LetterboxdHarvester extends IHarvester {
  #rssParser;
  #lifelogStore;
  #configService;
  #circuitBreaker;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.rssParser - RSS parser instance
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    rssParser,
    lifelogStore,
    configService,
    logger = console,
  }) {
    super();

    if (!rssParser) {
      throw new InfrastructureError('LetterboxdHarvester requires rssParser', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'rssParser'
      });
    }
    if (!lifelogStore) {
      throw new InfrastructureError('LetterboxdHarvester requires lifelogStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'lifelogStore'
      });
    }

    this.#rssParser = rssParser;
    this.#lifelogStore = lifelogStore;
    this.#configService = configService;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'letterboxd';
  }

  get category() {
    return HarvesterCategory.SOCIAL;
  }

  /**
   * Harvest movie diary from Letterboxd
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options (unused, RSS returns all recent)
   * @returns {Promise<{ count: number, status: string }>}
   */
  async harvest(username, options = {}) {
    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('letterboxd.harvest.skipped', {
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
      this.#logger.info?.('letterboxd.harvest.start', { username });

      // Get letterboxd username from config
      const auth = this.#configService?.getUserAuth?.('letterboxd', username) || {};
      const letterboxdUser = auth.username || this.#configService?.getSecret?.('LETTERBOXD_USER');

      if (!letterboxdUser) {
        throw new InfrastructureError('Letterboxd username not configured', {
        code: 'MISSING_CONFIG',
        service: 'Letterboxd'
      });
      }

      // Fetch RSS feed
      const url = `https://letterboxd.com/${letterboxdUser}/rss/`;
      const feed = await this.#rssParser.parseURL(url);

      // Parse movies from RSS items
      const movies = feed.items
        .map(item => this.#parseMovie(item))
        .filter(Boolean)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      // Save to lifelog
      await this.#lifelogStore.save(username, 'letterboxd', movies);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('letterboxd.harvest.complete', {
        username,
        letterboxdUser,
        movieCount: movies.length,
      });

      // Get latest date from first movie (sorted newest first)
      const latestDate = movies[0]?.date || null;

      return { count: movies.length, status: 'success', latestDate };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('letterboxd.harvest.error', {
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
   * Parse a movie from RSS item
   * @private
   */
  #parseMovie(item) {
    // RSS items have custom letterboxd namespace fields
    const watchedDate = item['letterboxd:watchedDate'] || null;
    const filmTitle = item['letterboxd:filmTitle'] || null;
    const filmYear = item['letterboxd:filmYear'] || null;
    const memberRating = item['letterboxd:memberRating'] || null;
    const rewatch = item['letterboxd:rewatch'] === 'Yes';
    const tmdbId = item['tmdb:movieId'] || null;

    if (!watchedDate || !filmTitle) {
      return null;
    }

    return {
      date: watchedDate,
      title: filmTitle,
      year: filmYear ? parseInt(filmYear, 10) : null,
      rating: memberRating ? parseFloat(memberRating) : null,
      rewatch,
      tmdbId: tmdbId ? parseInt(tmdbId, 10) : null,
      url: item.link || null,
    };
  }
}

export default LetterboxdHarvester;
