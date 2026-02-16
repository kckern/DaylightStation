// backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs
/**
 * RedditFeedAdapter
 *
 * Fetches Reddit posts via JSON API and normalizes to FeedItem shape.
 * Reads user-specific subreddit lists from DataService.
 *
 * @module adapters/feed/sources/RedditFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

const USER_AGENT = 'Mozilla/5.0 (compatible; DaylightStation/1.0)';

export class RedditFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.dataService - DataService for reading user config
   * @param {Object} [deps.logger]
   */
  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) throw new Error('RedditFeedAdapter requires dataService');
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'reddit'; }

  /**
   * @param {Object} query - Query config from YAML
   * @param {string} username
   * @returns {Promise<Object[]>} Normalized FeedItem-shaped objects
   */
  async fetchItems(query, username) {
    let subreddits = query.params?.subreddits;

    // Prefer user-specific config
    try {
      const userConfig = this.#dataService.user.read('config/reddit', username);
      if (userConfig?.subreddits?.length) {
        subreddits = userConfig.subreddits;
      }
    } catch { /* user config not found */ }

    if (!subreddits || !Array.isArray(subreddits) || subreddits.length === 0) return [];

    try {
      const maxSubs = query.params?.maxSubs || 5;
      const sampled = [...subreddits].sort(() => Math.random() - 0.5).slice(0, maxSubs);
      const perSub = Math.ceil((query.limit || 10) / sampled.length);

      const results = await Promise.allSettled(
        sampled.map(sub => this.#fetchSubreddit(sub, perSub, query))
      );

      const items = [];
      for (const result of results) {
        if (result.status === 'fulfilled') items.push(...result.value);
      }

      items.sort(() => Math.random() - 0.5);
      return items.slice(0, query.limit || 10);
    } catch (err) {
      this.#logger.warn?.('reddit.adapter.error', { error: err.message });
      return [];
    }
  }

  async #fetchSubreddit(subreddit, limit, query) {
    const url = `https://www.reddit.com/r/${subreddit}.json?limit=${limit}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const posts = data?.data?.children || [];

    return posts
      .filter(p => p.kind === 't3' && !p.data.stickied)
      .map(p => {
        const post = p.data;
        const thumb = post.thumbnail && !['self', 'default', 'nsfw', 'spoiler', ''].includes(post.thumbnail)
          ? post.thumbnail : null;
        return {
          id: `reddit:${post.id}`,
          type: query.feed_type || 'external',
          source: 'reddit',
          title: post.title,
          body: post.selftext?.slice(0, 200) || null,
          image: thumb,
          link: `https://www.reddit.com${post.permalink}`,
          timestamp: new Date(post.created_utc * 1000).toISOString(),
          priority: query.priority || 0,
          meta: {
            subreddit,
            score: post.score,
            numComments: post.num_comments,
            postId: post.id,
            sourceName: `r/${subreddit}`,
            sourceIcon: `https://www.reddit.com/r/${subreddit}`,
          },
        };
      });
  }
}
