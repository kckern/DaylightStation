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
      const feedConfig = this.#dataService.user.read('config/feed', username);
      if (feedConfig?.reddit?.subreddits?.length) {
        subreddits = feedConfig.reddit.subreddits;
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

  async getDetail(localId, meta, _username) {
    const postId = meta.postId || localId;
    const subreddit = meta.subreddit || 'all';
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}.json`,
        { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }
      );
      if (!res.ok) return null;
      const data = await res.json();

      const post = data?.[0]?.data?.children?.[0]?.data;
      const comments = data?.[1]?.data?.children || [];

      const sections = [];

      if (meta.youtubeId) {
        sections.push({ type: 'embed', data: { url: `https://www.youtube.com/embed/${meta.youtubeId}`, aspectRatio: '16:9' } });
      }

      if (post?.selftext) {
        sections.push({ type: 'body', data: { text: post.selftext } });
      }

      const commentItems = comments
        .filter(c => c.kind === 't1' && c.data?.body)
        .slice(0, 25)
        .map(c => ({
          author: c.data.author,
          body: c.data.body,
          score: c.data.score,
          depth: c.data.depth || 0,
        }));

      if (commentItems.length > 0) {
        sections.push({ type: 'comments', data: { items: commentItems } });
      }

      return sections.length > 0 ? { sections } : null;
    } catch (err) {
      this.#logger.warn?.('reddit.detail.error', { error: err.message, postId });
      return null;
    }
  }

  #proxyUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      return `/api/v1/proxy/reddit/${u.host}${u.pathname}${u.search}`;
    } catch {
      return rawUrl;
    }
  }

  #extractYoutubeId(url) {
    if (!url) return null;
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  #extractImage(post) {
    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;

    // Direct image link (i.redd.it, imgur, etc.)
    if (post.post_hint === 'image' && post.url) return post.url;
    if (post.url && IMAGE_EXT.test(post.url)) return post.url;

    // Reddit preview (URLs are HTML-entity-escaped)
    const preview = post.preview?.images?.[0]?.source?.url;
    if (preview) return preview.replace(/&amp;/g, '&');

    // Fall back to thumbnail if it's a real URL
    if (post.thumbnail && !['self', 'default', 'nsfw', 'spoiler', ''].includes(post.thumbnail)) {
      return post.thumbnail;
    }

    return null;
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
        const youtubeId = this.#extractYoutubeId(post.url);
        const rawImage = this.#extractImage(post) || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null);
        const image = rawImage ? this.#proxyUrl(rawImage) : null;
        return {
          id: `reddit:${post.id}`,
          tier: query.tier || 'wire',
          source: 'reddit',
          title: post.title,
          body: post.selftext?.slice(0, 200) || null,
          image,
          link: `https://www.reddit.com${post.permalink}`,
          timestamp: new Date(post.created_utc * 1000).toISOString(),
          priority: query.priority || 0,
          meta: {
            subreddit,
            score: post.score,
            numComments: post.num_comments,
            postId: post.id,
            youtubeId: youtubeId || undefined,
            sourceName: `r/${subreddit}`,
            sourceIcon: `https://www.reddit.com/r/${subreddit}`,
          },
        };
      });
  }
}
