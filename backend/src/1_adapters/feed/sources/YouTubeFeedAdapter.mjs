// backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs
/**
 * YouTubeFeedAdapter
 *
 * Fetches YouTube videos and normalizes to FeedItem shape.
 * - Channels: RSS first (free), API fallback (cached)
 * - Keywords: API search with in-memory TTL cache
 *
 * All fetches are cached (30 min TTL) to prevent quota exhaustion.
 *
 * @module adapters/feed/sources/YouTubeFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

const API_BASE = 'https://www.googleapis.com/youtube/v3/search';
const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const YT_THUMB_DIMS = {
  'maxresdefault': { w: 1280, h: 720 },
  'sddefault':     { w: 640,  h: 480 },
  'hqdefault':     { w: 480,  h: 360 },
  'mqdefault':     { w: 320,  h: 180 },
  'default':       { w: 120,  h: 90 },
};

export class YouTubeFeedAdapter extends IFeedSourceAdapter {
  #apiKey;
  #logger;
  /** @type {Map<string, { items: Object[], ts: number }>} */
  #cache = new Map();

  /**
   * @param {Object} deps
   * @param {string} deps.apiKey - YouTube Data API v3 key
   * @param {Object} [deps.logger]
   */
  constructor({ apiKey, logger = console }) {
    super();
    if (!apiKey) throw new Error('YouTubeFeedAdapter requires apiKey');
    this.#apiKey = apiKey;
    this.#logger = logger;
  }

  get sourceType() { return 'youtube'; }

  async fetchItems(query, _username) {
    const channels = query.params?.channels || [];
    const keywords = query.params?.keywords || [];
    const limit = query.limit || 10;

    if (channels.length === 0 && keywords.length === 0) return [];

    try {
      const fetches = [];
      const totalSources = channels.length + keywords.length;
      const perSource = Math.ceil(limit / (totalSources || 1));

      for (const channelId of channels) {
        fetches.push(this.#fetchChannel(channelId, perSource, query));
      }

      for (const keyword of keywords) {
        fetches.push(this.#searchKeywordCached(keyword, perSource, query));
      }

      const results = await Promise.allSettled(fetches);

      const items = [];
      for (const result of results) {
        if (result.status === 'fulfilled') items.push(...result.value);
        else this.#logger.warn?.('youtube.adapter.fetch.failed', { error: result.reason?.message });
      }

      items.sort(() => Math.random() - 0.5);
      return items.slice(0, limit);
    } catch (err) {
      this.#logger.warn?.('youtube.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta, _username) {
    const videoId = meta.videoId || localId;
    return {
      sections: [{
        type: 'embed',
        data: {
          provider: 'youtube',
          url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`,
          aspectRatio: '16:9',
        },
      }],
    };
  }

  // ======================================================================
  // Channel: RSS first, API fallback (both cached)
  // ======================================================================

  async #fetchChannel(channelId, maxResults, query) {
    const cacheKey = `ch:${channelId}`;
    const cached = this.#getFromCache(cacheKey);
    if (cached) return cached.slice(0, maxResults);

    // Try RSS first (free, no quota)
    try {
      const items = await this.#fetchChannelRSS(channelId, query);
      if (items.length > 0) {
        this.#putInCache(cacheKey, items);
        return items.slice(0, maxResults);
      }
    } catch (err) {
      this.#logger.info?.('youtube.adapter.rss.failed', { channelId, error: err.message });
    }

    // Fallback to API (costs quota, but cached)
    const items = await this.#fetchChannelAPI(channelId, maxResults, query);
    if (items.length > 0) this.#putInCache(cacheKey, items);
    return items.slice(0, maxResults);
  }

  async #fetchChannelRSS(channelId, query) {
    const url = `${RSS_BASE}?channel_id=${encodeURIComponent(channelId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`YouTube RSS ${res.status}`);

    const xml = await res.text();
    return this.#parseRSS(xml, query);
  }

  async #fetchChannelAPI(channelId, maxResults, query) {
    const params = new URLSearchParams({
      part: 'snippet',
      channelId,
      order: 'date',
      type: 'video',
      maxResults: String(maxResults),
      key: this.#apiKey,
    });

    return this.#fetchAPIAndNormalize(params, query);
  }

  #parseRSS(xml, query) {
    const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

    return entries.map(entry => {
      const videoId = this.#extractTag(entry, 'yt:videoId');
      if (!videoId) return null;

      const title = this.#extractTag(entry, 'title');
      const published = this.#extractTag(entry, 'published');
      const channelName = this.#extractTag(entry, 'name');
      const chId = this.#extractTag(entry, 'yt:channelId');

      const thumbMatch = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/);
      const image = thumbMatch?.[1] || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const descMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);
      const body = descMatch?.[1]?.slice(0, 200) || null;

      return {
        id: `youtube:${videoId}`,
        tier: query.tier || 'wire',
        source: 'youtube',
        title: this.#decodeEntities(title),
        body: body ? this.#decodeEntities(body) : null,
        image,
        link: `https://www.youtube.com/watch?v=${videoId}`,
        timestamp: published || new Date().toISOString(),
        priority: query.priority || 0,
        meta: {
          playable: true,
          channelName: channelName || 'YouTube',
          channelId: chId,
          videoId,
          sourceName: channelName || 'YouTube',
          sourceIcon: 'https://www.youtube.com',
          ...this.#thumbDimensions(image),
        },
      };
    }).filter(Boolean);
  }

  // ======================================================================
  // Keyword API search (cached)
  // ======================================================================

  async #searchKeywordCached(keyword, maxResults, query) {
    const cacheKey = `kw:${keyword}`;
    const cached = this.#getFromCache(cacheKey);
    if (cached) {
      this.#logger.info?.('youtube.adapter.cache.hit', { keyword });
      return cached.slice(0, maxResults);
    }

    const params = new URLSearchParams({
      part: 'snippet',
      q: keyword,
      order: 'relevance',
      type: 'video',
      maxResults: String(maxResults),
      key: this.#apiKey,
    });

    const items = await this.#fetchAPIAndNormalize(params, query);
    this.#putInCache(cacheKey, items);
    return items;
  }

  // ======================================================================
  // Shared API fetch + normalize
  // ======================================================================

  async #fetchAPIAndNormalize(params, query) {
    const res = await fetch(`${API_BASE}?${params}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`YouTube API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return (data.items || [])
      .filter(v => v.id?.videoId)
      .map(v => {
        const snippet = v.snippet;
        const videoId = v.id.videoId;
        const image = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || null;
        return {
          id: `youtube:${videoId}`,
          tier: query.tier || 'wire',
          source: 'youtube',
          title: snippet.title,
          body: snippet.description?.slice(0, 200) || null,
          image,
          link: `https://www.youtube.com/watch?v=${videoId}`,
          timestamp: snippet.publishedAt || new Date().toISOString(),
          priority: query.priority || 0,
          meta: {
            playable: true,
            channelName: snippet.channelTitle,
            channelId: snippet.channelId,
            videoId,
            sourceName: snippet.channelTitle || 'YouTube',
            sourceIcon: 'https://www.youtube.com',
            ...this.#apiThumbDimensions(snippet, image),
          },
        };
      });
  }

  // ======================================================================
  // Cache helpers
  // ======================================================================

  #getFromCache(key) {
    const entry = this.#cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      this.#cache.delete(key);
      return null;
    }
    return entry.items;
  }

  #putInCache(key, items) {
    this.#cache.set(key, { items, ts: Date.now() });
    // Evict old entries if cache grows large
    if (this.#cache.size > 50) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }
  }

  // ======================================================================
  // Thumbnail dimension helpers
  // ======================================================================

  #thumbDimensions(url) {
    if (!url) return {};
    for (const [key, dims] of Object.entries(YT_THUMB_DIMS)) {
      if (url.includes(key)) return { imageWidth: dims.w, imageHeight: dims.h };
    }
    return {};
  }

  #apiThumbDimensions(snippet, imageUrl) {
    for (const key of ['high', 'medium', 'default', 'maxres', 'standard']) {
      const t = snippet.thumbnails?.[key];
      if (t?.url === imageUrl && t.width && t.height) {
        return { imageWidth: t.width, imageHeight: t.height };
      }
    }
    return this.#thumbDimensions(imageUrl);
  }

  // ======================================================================
  // XML helpers
  // ======================================================================

  #extractTag(block, tag) {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : '';
  }

  #decodeEntities(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'");
  }
}
