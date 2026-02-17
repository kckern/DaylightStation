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

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class RedditFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #logger;
  #rotationIndex = 0;

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
    let subredditConfig = query.params?.subreddits;

    // Prefer user-specific config
    try {
      const feedConfig = this.#dataService.user.read('config/feed', username);
      if (feedConfig?.reddit?.subreddits) {
        subredditConfig = feedConfig.reddit.subreddits;
      }
    } catch { /* user config not found */ }

    if (!subredditConfig) return [];

    try {
      const limit = query.limit || 15;
      const subs = this.#resolveSubreddits(subredditConfig);

      // Single request using r/sub1+sub2+sub3 pattern
      const items = await this.#fetchMultiSubreddit(subs, limit, query);
      return items.slice(0, limit);
    } catch (err) {
      this.#logger.warn?.('reddit.adapter.error', { error: err.message });
      return [];
    }
  }

  /**
   * Resolve subreddit config into a flat list for the current batch.
   * Supports both legacy flat array and tiered { daily, regular, occasional } objects.
   */
  #resolveSubreddits(config) {
    // Legacy flat array — random sample
    if (Array.isArray(config)) {
      return [...config].sort(() => Math.random() - 0.5).slice(0, 15);
    }

    const idx = this.#rotationIndex++;
    const subs = [];

    // Daily: all groups every batch
    if (config.daily) {
      for (const group of Object.values(config.daily)) {
        subs.push(...group.split('+'));
      }
    }

    // Regular: rotate ~half of groups per batch
    if (config.regular) {
      const groups = Object.values(config.regular);
      const half = Math.max(1, Math.ceil(groups.length / 2));
      const start = (idx * half) % groups.length;
      for (let i = 0; i < half; i++) {
        const group = groups[(start + i) % groups.length];
        subs.push(...group.split('+'));
      }
    }

    // Occasional: rotate one group per batch
    if (config.occasional) {
      const groups = Object.values(config.occasional);
      const group = groups[idx % groups.length];
      subs.push(...group.split('+'));
    }

    // Deduplicate
    return [...new Set(subs)];
  }

  /**
   * Paginated fetch — returns items plus a cursor for the next page.
   *
   * @param {Object} query - Query config from YAML
   * @param {string} username
   * @param {Object} [options]
   * @param {string|null} [options.cursor] - Reddit "after" token from a previous call
   * @returns {Promise<{ items: Object[], cursor: string|null }>}
   */
  async fetchPage(query, username, { cursor } = {}) {
    let subredditConfig = query.params?.subreddits;
    try {
      const feedConfig = this.#dataService.user.read('config/feed', username);
      if (feedConfig?.reddit?.subreddits) {
        subredditConfig = feedConfig.reddit.subreddits;
      }
    } catch { /* user config not found */ }

    if (!subredditConfig) return { items: [], cursor: null };

    try {
      const limit = query.limit || 15;
      const subs = this.#resolveSubreddits(subredditConfig);
      const { items, after } = await this.#fetchMultiSubredditPaginated(subs, limit, query, cursor);
      return { items: items.slice(0, limit), cursor: after || null };
    } catch (err) {
      this.#logger.warn?.('reddit.adapter.error', { error: err.message });
      return { items: [], cursor: null };
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

  async #fetchMultiSubreddit(subreddits, limit, query, attempt = 0) {
    const combined = subreddits.join('+');
    const url = `https://www.reddit.com/r/${combined}.json?limit=${limit}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (res.status === 429 && attempt < 2) {
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      return this.#fetchMultiSubreddit(subreddits, limit, query, attempt + 1);
    }
    if (!res.ok) return [];

    const data = await res.json();
    const posts = data?.data?.children || [];

    return posts
      .filter(p => p.kind === 't3' && !p.data.stickied)
      .map(p => {
        const post = p.data;
        const subreddit = post.subreddit;
        const youtubeId = this.#extractYoutubeId(post.url);
        const previewSource = post.preview?.images?.[0]?.source;
        const imageWidth = previewSource?.width || undefined;
        const imageHeight = previewSource?.height || undefined;
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
            ...(imageWidth && imageHeight ? { imageWidth, imageHeight } : {}),
          },
        };
      });
  }

  async #fetchMultiSubredditPaginated(subreddits, limit, query, afterToken, attempt = 0) {
    const combined = subreddits.join('+');
    const afterParam = afterToken ? `&after=${afterToken}` : '';
    const url = `https://www.reddit.com/r/${combined}.json?limit=${limit}${afterParam}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (res.status === 429 && attempt < 2) {
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      return this.#fetchMultiSubredditPaginated(subreddits, limit, query, afterToken, attempt + 1);
    }
    if (!res.ok) return { items: [], after: null };

    const data = await res.json();
    const posts = data?.data?.children || [];
    const after = data?.data?.after || null;

    const items = posts
      .filter(p => p.kind === 't3' && !p.data.stickied)
      .map(p => {
        const post = p.data;
        const subreddit = post.subreddit;
        const youtubeId = this.#extractYoutubeId(post.url);
        const previewSource = post.preview?.images?.[0]?.source;
        const imageWidth = previewSource?.width || undefined;
        const imageHeight = previewSource?.height || undefined;
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
            ...(imageWidth && imageHeight ? { imageWidth, imageHeight } : {}),
          },
        };
      });

    return { items, after };
  }
}
