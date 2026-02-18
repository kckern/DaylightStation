// backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs
/**
 * FreshRSSSourceAdapter
 *
 * Fetches RSS items from FreshRSS via the underlying FreshRSS API adapter
 * and normalizes them to FeedItem shape.
 *
 * Uses a two-pass approach: unread items first (prioritized), then backfill
 * with read items (shuffled for variety).
 *
 * Extracted from FeedPoolManager#fetchFreshRSSPage() to follow the standard
 * IFeedSourceAdapter pattern.
 *
 * Renamed from FreshRSSFeedAdapter to avoid collision with the low-level
 * GReader API client at 1_adapters/feed/FreshRSSFeedAdapter.mjs.
 *
 * @module adapters/feed/sources/FreshRSSSourceAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';
import { probeImageDimensions } from '#system/utils/probeImageDimensions.mjs';

export class FreshRSSSourceAdapter extends IFeedSourceAdapter {
  #freshRSSAdapter;
  #configService;
  #logger;

  static #DEFAULT_UNREAD_PER_SOURCE = 20;
  static #DEFAULT_TOTAL_LIMIT = 100;
  static #DEFAULT_MAX_UNREAD_PER_FEED = 3;

  constructor({ freshRSSAdapter, configService = null, logger = console }) {
    super();
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#configService = configService;
    this.#logger = logger;
  }

  get sourceType() { return 'freshrss'; }
  get provides() { return [CONTENT_TYPES.FEEDS]; }

  #getReaderConfig() {
    if (!this.#configService) {
      return {
        unreadPerSource: FreshRSSSourceAdapter.#DEFAULT_UNREAD_PER_SOURCE,
        totalLimit: FreshRSSSourceAdapter.#DEFAULT_TOTAL_LIMIT,
        maxUnreadPerFeed: FreshRSSSourceAdapter.#DEFAULT_MAX_UNREAD_PER_FEED,
      };
    }
    const feedConfig = this.#configService.getAppConfig?.('feed') || {};
    const reader = feedConfig.reader || {};
    return {
      unreadPerSource: reader.unread_per_source ?? FreshRSSSourceAdapter.#DEFAULT_UNREAD_PER_SOURCE,
      totalLimit: reader.total_limit ?? FreshRSSSourceAdapter.#DEFAULT_TOTAL_LIMIT,
      maxUnreadPerFeed: reader.max_unread_per_feed ?? FreshRSSSourceAdapter.#DEFAULT_MAX_UNREAD_PER_FEED,
    };
  }

  async fetchPage(query, username, { cursor } = {}) {
    if (!this.#freshRSSAdapter) return { items: [], cursor: null };

    const { unreadPerSource, totalLimit, maxUnreadPerFeed } = this.#getReaderConfig();
    const streamId = 'user/-/state/com.google/reading-list';

    // Pass 1: over-fetch unread, then cap per feed for diversity
    const fetchCount = maxUnreadPerFeed ? totalLimit : unreadPerSource;
    const { items: unreadRaw, continuation } = await this.#freshRSSAdapter.getItems(
      streamId, username, {
        excludeRead: true,
        count: fetchCount,
        continuation: cursor || undefined,
      }
    );

    const cappedUnread = maxUnreadPerFeed
      ? this.#capPerFeed(unreadRaw, maxUnreadPerFeed, unreadPerSource)
      : unreadRaw.slice(0, unreadPerSource);

    const unreadIds = new Set(cappedUnread.map(i => i.id));
    const unreadItems = cappedUnread.map(item => this.#normalize(item, query, false));

    // If unread fills the limit, skip pass 2
    if (unreadItems.length >= totalLimit) {
      const page = unreadItems.slice(0, totalLimit);
      await this.#probeDimensions(page);
      return { items: page, cursor: continuation || null };
    }

    // Pass 2: all items (to backfill with read)
    let readItems = [];
    try {
      const { items: allRaw } = await this.#freshRSSAdapter.getItems(
        streamId, username, {
          excludeRead: false,
          count: totalLimit,
        }
      );
      const readRaw = allRaw.filter(i => !unreadIds.has(i.id));
      // Shuffle read items for variety
      readItems = readRaw.map(item => this.#normalize(item, query, true));
      for (let i = readItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [readItems[i], readItems[j]] = [readItems[j], readItems[i]];
      }
    } catch (err) {
      this.#logger.warn?.('freshrss.backfill.error', { error: err.message });
    }

    const merged = [...unreadItems, ...readItems].slice(0, totalLimit);
    await this.#probeDimensions(merged);
    return { items: merged, cursor: continuation || null };
  }

  /**
   * Cap items per feed to prevent one prolific feed from dominating.
   * Preserves chronological order within each feed's allocation.
   */
  #capPerFeed(items, maxPerFeed, totalCap) {
    const counts = new Map();
    const result = [];
    for (const item of items) {
      const feedKey = item.feedId || item.feedTitle || 'unknown';
      const count = counts.get(feedKey) || 0;
      if (count < maxPerFeed) {
        result.push(item);
        counts.set(feedKey, count + 1);
        if (result.length >= totalCap) break;
      }
    }
    return result;
  }

  #normalize(item, query, isRead) {
    const image = this.#extractImage(item.content);
    return {
      id: `freshrss:${item.id}`,
      tier: query.tier || 'wire',
      source: 'freshrss',
      title: item.title,
      body: item.content ? item.content.replace(/<[^>]*>/g, '').slice(0, 200) : null,
      image,
      link: item.link,
      timestamp: item.published?.toISOString?.() || item.published || new Date().toISOString(),
      priority: query.priority || 0,
      meta: {
        feedTitle: item.feedTitle,
        author: item.author,
        sourceName: item.feedTitle || 'RSS',
        sourceIcon: item.link ? (() => { try { return new URL(item.link).origin; } catch { return null; } })() : null,
        isRead,
      },
    };
  }

  /**
   * Probe dimensions for items that have images but no dims.
   */
  async #probeDimensions(items) {
    await Promise.all(items.map(async item => {
      if (!item.image || item.meta?.imageWidth) return;
      const dims = await probeImageDimensions(item.image);
      if (dims) {
        item.meta.imageWidth = dims.width;
        item.meta.imageHeight = dims.height;
      }
    }));
  }

  /**
   * Mark items as read via FreshRSS GReader API.
   * @param {string[]} itemIds - Prefixed IDs ("freshrss:xxx") or raw IDs
   * @param {string} username
   */
  async markRead(itemIds, username) {
    if (!this.#freshRSSAdapter) return;
    const stripped = itemIds.map(id => id.startsWith('freshrss:') ? id.slice('freshrss:'.length) : id);
    await this.#freshRSSAdapter.markRead(stripped, username);
  }

  #extractImage(html) {
    if (!html) return null;
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }
}
