// backend/src/1_adapters/feed/sources/GoogleNewsFeedAdapter.mjs
/**
 * GoogleNewsFeedAdapter
 *
 * Fetches Google News headlines via public RSS feeds for configured topics.
 * No API key needed — uses Google News RSS search endpoint.
 *
 * @module adapters/feed/sources/GoogleNewsFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

const RSS_BASE = 'https://news.google.com/rss/search';

export class GoogleNewsFeedAdapter extends IFeedSourceAdapter {
  #logger;

  constructor({ logger = console }) {
    super();
    this.#logger = logger;
  }

  get sourceType() { return 'googlenews'; }

  async fetchItems(query, _username) {
    const topics = query.params?.topics || [];
    const limit = query.limit || 10;

    if (topics.length === 0) return [];

    try {
      const perTopic = Math.ceil(limit / topics.length);

      const results = await Promise.allSettled(
        topics.map(topic => this.#fetchTopic(topic, perTopic, query))
      );

      const items = [];
      for (const result of results) {
        if (result.status === 'fulfilled') items.push(...result.value);
        else this.#logger.warn?.('googlenews.adapter.fetch.failed', { error: result.reason?.message });
      }

      // Shuffle and cap
      items.sort(() => Math.random() - 0.5);
      return items.slice(0, limit);
    } catch (err) {
      this.#logger.warn?.('googlenews.adapter.error', { error: err.message });
      return [];
    }
  }

  async #fetchTopic(topic, maxResults, query) {
    const params = new URLSearchParams({
      q: topic,
      hl: 'en-US',
      gl: 'US',
      ceid: 'US:en',
    });

    const res = await fetch(`${RSS_BASE}?${params}`);
    if (!res.ok) throw new Error(`Google News RSS ${res.status}`);

    const xml = await res.text();
    return this.#parseRSS(xml, topic, maxResults, query);
  }

  #parseRSS(xml, topic, maxResults, query) {
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

    return itemBlocks.slice(0, maxResults).map(block => {
      const title = this.#extractTag(block, 'title');
      const link = this.#extractTag(block, 'link');
      const pubDate = this.#extractTag(block, 'pubDate');
      const sourceName = this.#extractTag(block, 'source');
      const sourceUrl = block.match(/<source url="([^"]+)"/)?.[1] || null;

      // Strip " - SourceName" suffix from title (Google News appends it)
      const cleanTitle = sourceName
        ? title.replace(new RegExp(`\\s*-\\s*${this.#escapeRegex(sourceName)}$`), '')
        : title;

      const guid = block.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1] || link;

      return {
        id: `googlenews:${this.#hashId(guid || link || title)}`,
        tier: query.tier || 'wire',
        source: 'googlenews',
        title: this.#decodeEntities(cleanTitle),
        body: null,
        image: null,
        link,
        timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        priority: query.priority || 0,
        meta: {
          topic,
          outlet: sourceName ? this.#decodeEntities(sourceName) : null,
          outletUrl: sourceUrl,
          sourceName: sourceName ? this.#decodeEntities(sourceName) : 'Google News',
          sourceIcon: sourceUrl || 'https://news.google.com',
        },
      };
    });
  }

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

  #escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  #hashId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }
}
