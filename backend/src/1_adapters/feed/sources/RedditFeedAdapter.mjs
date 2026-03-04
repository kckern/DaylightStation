// backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs
/**
 * RedditFeedAdapter
 *
 * Fetches Reddit posts via JSON API and normalizes to FeedItem shape.
 * Reads user-specific subreddit lists from DataService.
 *
 * @module adapters/feed/sources/RedditFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

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
  get provides() { return [CONTENT_TYPES.SOCIAL]; }

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

  /**
   * Extract ordered gallery image URLs from a Reddit gallery post.
   * Returns array of { url, thumbnail, width, height } using gallery_data order.
   * `thumbnail` is the smallest preview ≥ 320px wide (for progressive loading).
   */
  #extractGalleryImages(post) {
    if (!post.is_gallery) return [];
    const items = post.gallery_data?.items || [];
    const metadata = post.media_metadata || {};
    const images = [];
    for (const item of items) {
      const meta = metadata[item.media_id];
      if (!meta || meta.status !== 'valid') continue;
      const s = meta.s;
      if (!s?.u) continue;
      // Pick smallest preview ≥ 320px as thumbnail for progressive loading
      const previews = meta.p || [];
      const thumb = previews.find(p => p.x >= 320) || previews[previews.length - 1];
      images.push({
        url: s.u.replace(/&amp;/g, '&'),
        thumbnail: thumb?.u ? thumb.u.replace(/&amp;/g, '&') : undefined,
        width: s.x,
        height: s.y,
      });
    }
    return images;
  }

  #extractImage(post) {
    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;

    // Gallery posts — use first gallery image
    if (post.is_gallery) {
      const gallery = this.#extractGalleryImages(post);
      if (gallery.length > 0) return gallery[0].url;
    }

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

  #normalizePost(post, query) {
    const subreddit = post.subreddit;
    const youtubeId = this.#extractYoutubeId(post.url);
    const galleryImages = this.#extractGalleryImages(post);

    // Dimensions: prefer gallery first image, then preview source
    let imageWidth, imageHeight;
    if (galleryImages.length > 0) {
      imageWidth = galleryImages[0].width;
      imageHeight = galleryImages[0].height;
    } else {
      const previewSource = post.preview?.images?.[0]?.source;
      imageWidth = previewSource?.width || undefined;
      imageHeight = previewSource?.height || undefined;
    }

    const rawImage = this.#extractImage(post) || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null);
    const image = rawImage ? this.#proxyUrl(rawImage) : null;

    // Thumbnail for progressive loading: gallery first-image thumb, or reddit preview smallest ≥ 320px
    let thumbnail;
    if (galleryImages.length > 0 && galleryImages[0].thumbnail) {
      thumbnail = this.#proxyUrl(galleryImages[0].thumbnail);
    } else {
      const previews = post.preview?.images?.[0]?.resolutions || [];
      const thumb = previews.find(p => p.width >= 320) || previews[previews.length - 1];
      if (thumb?.url) thumbnail = this.#proxyUrl(thumb.url.replace(/&amp;/g, '&'));
    }

    return {
      id: `reddit:${post.id}`,
      tier: query.tier || 'wire',
      source: 'reddit',
      title: post.title,
      body: post.selftext?.slice(0, 200) || null,
      image,
      thumbnail: thumbnail || undefined,
      link: `https://www.reddit.com${post.permalink}`,
      timestamp: new Date(post.created_utc * 1000).toISOString(),
      priority: query.priority || 0,
      meta: {
        subreddit,
        score: post.score,
        numComments: post.num_comments,
        postId: post.id,
        youtubeId: youtubeId || undefined,
        ...(youtubeId ? { playable: true } : {}),
        sourceName: `r/${subreddit}`,
        sourceIcon: `https://www.reddit.com/r/${subreddit}`,
        ...(imageWidth && imageHeight ? { imageWidth, imageHeight } : {}),
        ...(galleryImages.length > 1 ? {
          galleryImages: galleryImages.map(g => ({
            url: this.#proxyUrl(g.url),
            thumbnail: g.thumbnail ? this.#proxyUrl(g.thumbnail) : undefined,
            width: g.width,
            height: g.height,
          })),
        } : {}),
      },
    };
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
      .map(p => this.#normalizePost(p.data, query));
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
      .map(p => this.#normalizePost(p.data, query));

    return { items, after };
  }
}
