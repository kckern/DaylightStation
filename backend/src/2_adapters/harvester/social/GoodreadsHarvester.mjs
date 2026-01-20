/**
 * GoodreadsHarvester
 *
 * Fetches user's reading history from Goodreads via RSS feed.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - RSS feed parsing for read books
 * - Rating and review extraction
 * - Author and title parsing
 *
 * @module harvester/social/GoodreadsHarvester
 */

import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';

/**
 * Goodreads book harvester
 * @implements {IHarvester}
 */
export class GoodreadsHarvester extends IHarvester {
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
      throw new Error('GoodreadsHarvester requires rssParser');
    }
    if (!lifelogStore) {
      throw new Error('GoodreadsHarvester requires lifelogStore');
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
    return 'goodreads';
  }

  get category() {
    return HarvesterCategory.SOCIAL;
  }

  /**
   * Harvest books from Goodreads
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {string} [options.shelf='read'] - Shelf to fetch
   * @returns {Promise<{ count: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { shelf = 'read' } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('goodreads.harvest.skipped', {
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
      this.#logger.info?.('goodreads.harvest.start', { username, shelf });

      // Get auth
      const auth = this.#configService?.getUserAuth?.('goodreads', username) || {};
      const goodreadsUserId = auth.user_id || process.env.GOODREADS_USER;

      if (!goodreadsUserId) {
        throw new Error('Goodreads user ID not configured');
      }

      const url = `https://www.goodreads.com/review/list_rss/${goodreadsUserId}?shelf=${shelf}`;
      const feed = await this.#rssParser.parseURL(url);

      const books = feed.items.map(item => this.#parseBook(item))
        .sort((a, b) => new Date(b.readAt || 0) - new Date(a.readAt || 0));

      // Save to lifelog
      await this.#lifelogStore.save(username, 'goodreads', books);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('goodreads.harvest.complete', {
        username,
        goodreadsUserId,
        bookCount: books.length,
      });

      return { count: books.length, status: 'success' };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('goodreads.harvest.error', {
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
   * Parse a book from RSS item
   * @private
   */
  #parseBook(item) {
    const readAt = item.content?.match(/read at: (\d{4}\/\d{2}\/\d{2})/i)?.[1]?.replace(/\//g, '-') || '';
    const rating = parseInt(item.content?.match(/rating: (\d)/i)?.[1]) || null;
    const author = item.content?.match(/author: (.*?)<br\/>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const bookId = parseInt(item.link?.match(/review\/show\/(\d+)/i)?.[1]) || null;
    const review = item.contentSnippet || null;

    return {
      bookId,
      title: item.title?.replace(/\s+/g, ' ').trim() || '',
      author,
      readAt,
      rating,
      review,
    };
  }
}

export default GoodreadsHarvester;
