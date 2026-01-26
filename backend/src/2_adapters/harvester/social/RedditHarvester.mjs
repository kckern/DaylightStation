/**
 * RedditHarvester
 *
 * Fetches user's Reddit activity (posts, comments, upvotes, saved) using public JSON API.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Posts and comments fetching
 * - Upvotes and saved posts (if public)
 * - No OAuth required for public data
 *
 * @module harvester/social/RedditHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '../../../0_system/config/index.mjs';

/**
 * Reddit activity harvester
 * @implements {IHarvester}
 */
export class RedditHarvester extends IHarvester {
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
      throw new Error('RedditHarvester requires httpClient');
    }
    if (!lifelogStore) {
      throw new Error('RedditHarvester requires lifelogStore');
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
    return 'reddit';
  }

  get category() {
    return HarvesterCategory.SOCIAL;
  }

  /**
   * Harvest activity from Reddit
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.limit=100] - Max items per category to fetch
   * @returns {Promise<{ count: number, stats: Object, status: string }>}
   */
  async harvest(username, options = {}) {
    const { limit = 100 } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('reddit.harvest.skipped', {
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
      this.#logger.info?.('reddit.harvest.start', { username, limit });

      // Get auth
      const auth = this.#configService?.getUserAuth?.('reddit', username) || {};
      const redditUsername = auth.username;

      if (!redditUsername) {
        throw new Error('Reddit username not configured');
      }

      const headers = { 'User-Agent': 'DaylightStation-Harvester/1.0' };
      const activities = [];

      // Fetch posts
      const posts = await this.#fetchPosts(redditUsername, limit, headers);
      activities.push(...posts);

      // Fetch comments
      const comments = await this.#fetchComments(redditUsername, limit, headers);
      activities.push(...comments);

      // Try fetching upvotes (may be private)
      try {
        const upvotes = await this.#fetchUpvotes(redditUsername, limit, headers);
        activities.push(...upvotes);
      } catch (error) {
        this.#logger.debug?.('reddit.upvotes.private', {
          redditUsername,
          message: 'Upvotes not accessible (may be private)',
        });
      }

      // Try fetching saved (may be private)
      try {
        const saved = await this.#fetchSaved(redditUsername, limit, headers);
        activities.push(...saved);
      } catch (error) {
        this.#logger.debug?.('reddit.saved.private', {
          redditUsername,
          message: 'Saved posts not accessible (may be private)',
        });
      }

      // Sort by timestamp descending
      activities.sort((a, b) => b.timestamp - a.timestamp);

      // Save to lifelog
      await this.#lifelogStore.save(username, 'reddit', activities);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const stats = {
        total: activities.length,
        posts: activities.filter(a => a.type === 'post').length,
        comments: activities.filter(a => a.type === 'comment').length,
        upvotes: activities.filter(a => a.type === 'upvote').length,
        saved: activities.filter(a => a.type === 'saved').length,
        subreddits: [...new Set(activities.map(a => a.subreddit))].length,
      };

      this.#logger.info?.('reddit.harvest.complete', {
        username,
        redditUsername,
        ...stats,
      });

      return { count: activities.length, stats, status: 'success' };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('reddit.harvest.error', {
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
   * Fetch user's posts
   * @private
   */
  async #fetchPosts(redditUsername, limit, headers) {
    const response = await this.#httpClient.get(
      `https://www.reddit.com/user/${redditUsername}/submitted.json`,
      { params: { limit }, headers }
    );

    return (response.data?.data?.children || []).map(post => {
      const data = post.data;
      return {
        id: data.id,
        type: 'post',
        subreddit: data.subreddit,
        title: data.title,
        url: `https://reddit.com${data.permalink}`,
        selftext: data.selftext || null,
        score: data.score,
        upvoteRatio: data.upvote_ratio,
        numComments: data.num_comments,
        createdAt: moment.unix(data.created_utc).toISOString(),
        date: moment.unix(data.created_utc).tz(this.#timezone).format('YYYY-MM-DD'),
        timestamp: data.created_utc,
        isNsfw: data.over_18,
        linkUrl: data.is_self ? null : data.url,
      };
    });
  }

  /**
   * Fetch user's comments
   * @private
   */
  async #fetchComments(redditUsername, limit, headers) {
    const response = await this.#httpClient.get(
      `https://www.reddit.com/user/${redditUsername}/comments.json`,
      { params: { limit }, headers }
    );

    return (response.data?.data?.children || []).map(comment => {
      const data = comment.data;
      return {
        id: data.id,
        type: 'comment',
        subreddit: data.subreddit,
        body: data.body,
        url: `https://reddit.com${data.permalink}`,
        score: data.score,
        parentId: data.parent_id,
        linkTitle: data.link_title,
        createdAt: moment.unix(data.created_utc).toISOString(),
        date: moment.unix(data.created_utc).tz(this.#timezone).format('YYYY-MM-DD'),
        timestamp: data.created_utc,
        isNsfw: data.over_18,
      };
    });
  }

  /**
   * Fetch user's upvotes
   * @private
   */
  async #fetchUpvotes(redditUsername, limit, headers) {
    const response = await this.#httpClient.get(
      `https://www.reddit.com/user/${redditUsername}/upvoted.json`,
      { params: { limit }, headers }
    );

    return (response.data?.data?.children || []).map(item => {
      const data = item.data;
      return {
        id: `upvote_${data.id}`,
        type: 'upvote',
        subreddit: data.subreddit,
        title: data.title,
        url: `https://reddit.com${data.permalink}`,
        author: data.author,
        score: data.score,
        createdAt: moment.unix(data.created_utc).toISOString(),
        date: moment.unix(data.created_utc).tz(this.#timezone).format('YYYY-MM-DD'),
        timestamp: data.created_utc,
        isNsfw: data.over_18,
      };
    });
  }

  /**
   * Fetch user's saved posts
   * @private
   */
  async #fetchSaved(redditUsername, limit, headers) {
    const response = await this.#httpClient.get(
      `https://www.reddit.com/user/${redditUsername}/saved.json`,
      { params: { limit }, headers }
    );

    return (response.data?.data?.children || []).map(item => {
      const data = item.data;
      return {
        id: `saved_${data.id}`,
        type: 'saved',
        subreddit: data.subreddit,
        title: data.title || data.link_title,
        body: data.body || null,
        url: `https://reddit.com${data.permalink}`,
        author: data.author,
        score: data.score,
        createdAt: moment.unix(data.created_utc).toISOString(),
        date: moment.unix(data.created_utc).tz(this.#timezone).format('YYYY-MM-DD'),
        timestamp: data.created_utc,
        isNsfw: data.over_18,
      };
    });
  }
}

export default RedditHarvester;
