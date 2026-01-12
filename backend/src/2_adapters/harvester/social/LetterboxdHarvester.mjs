/**
 * LetterboxdHarvester
 *
 * Fetches user's movie diary from Letterboxd via HTML scraping.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Movie diary scraping
 * - Rating extraction
 * - Paginated fetching
 *
 * @module harvester/social/LetterboxdHarvester
 */

import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';

/**
 * Letterboxd movie diary harvester
 * @implements {IHarvester}
 */
export class LetterboxdHarvester extends IHarvester {
  #httpClient;
  #lifelogStore;
  #configService;
  #circuitBreaker;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for requests
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    httpClient,
    lifelogStore,
    configService,
    logger = console,
  }) {
    super();

    if (!httpClient) {
      throw new Error('LetterboxdHarvester requires httpClient');
    }
    if (!lifelogStore) {
      throw new Error('LetterboxdHarvester requires lifelogStore');
    }

    this.#httpClient = httpClient;
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
   * @param {Object} [options] - Harvest options
   * @param {number} [options.maxPages=10] - Max pages to fetch
   * @returns {Promise<{ count: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { maxPages = 10 } = options;

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
      this.#logger.info?.('letterboxd.harvest.start', { username, maxPages });

      // Get auth
      const auth = this.#configService?.getUserAuth?.('letterboxd', username) || {};
      const letterboxdUser = auth.username || process.env.LETTERBOXD_USER;

      if (!letterboxdUser) {
        throw new Error('Letterboxd username not configured');
      }

      const movies = [];
      let page = 1;

      while (page <= maxPages) {
        const response = await this.#httpClient.get(
          `https://letterboxd.com/${letterboxdUser}/films/diary/page/${page}/`
        );

        const html = response.data.replace(/\n/g, ' ');
        const pageMovies = this.#parseMovies(html);

        if (pageMovies.length === 0) {
          break;
        }

        movies.push(...pageMovies);
        page++;
      }

      // Save to lifelog
      await this.#lifelogStore.save(username, 'letterboxd', movies);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('letterboxd.harvest.complete', {
        username,
        letterboxdUser,
        movieCount: movies.length,
        pages: page - 1,
      });

      return { count: movies.length, status: 'success' };

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
   * Parse movies from HTML
   * @private
   */
  #parseMovies(html) {
    const rowMatches = html.match(/class="diary-entry-row[^"]*"[^>]*>.*?<\/tr>/gim) || [];

    return rowMatches.map(row => {
      // Extract date
      const dateMatch = row.match(/class="daydate"[^>]*href="[^"]*\/for\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/"/i)
        || row.match(/href="[^"]*\/for\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/"[^>]*class="daydate"/i);

      // Extract film name
      const titleMatch = row.match(/data-item-name="([^"]+)"/i);

      // Extract film link
      const linkMatch = row.match(/data-item-link="([^"]+)"/i);

      // Extract rating
      const ratingMatch = row.match(/class="rateit-field[^"]*"[^>]*value="(\d+)"/i)
        || row.match(/value="(\d+)"[^>]*class="rateit-field/i);

      if (!dateMatch || !titleMatch) {
        return null;
      }

      const year = dateMatch[1];
      const month = dateMatch[2].padStart(2, '0');
      const day = dateMatch[3].padStart(2, '0');

      // Clean title - remove year suffix
      let title = titleMatch[1];
      title = title.replace(/\s*\(\d{4}\)$/, '');

      return {
        date: `${year}-${month}-${day}`,
        title,
        rating: ratingMatch ? ratingMatch[1] : null,
        url: linkMatch ? `https://letterboxd.com${linkMatch[1]}` : null,
      };
    }).filter(Boolean);
  }
}

export default LetterboxdHarvester;
