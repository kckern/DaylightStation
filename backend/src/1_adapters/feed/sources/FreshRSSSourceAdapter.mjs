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

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class FreshRSSSourceAdapter extends IFeedSourceAdapter {
  #freshRSSAdapter;
  #configService;
  #logger;

  static #DEFAULT_UNREAD_PER_SOURCE = 20;
  static #DEFAULT_TOTAL_LIMIT = 100;

  constructor({ freshRSSAdapter, configService = null, logger = console }) {
    super();
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#configService = configService;
    this.#logger = logger;
  }

  get sourceType() { return 'freshrss'; }

  #getReaderConfig() {
    if (!this.#configService) {
      return {
        unreadPerSource: FreshRSSSourceAdapter.#DEFAULT_UNREAD_PER_SOURCE,
        totalLimit: FreshRSSSourceAdapter.#DEFAULT_TOTAL_LIMIT,
      };
    }
    const feedConfig = this.#configService.getAppConfig?.('feed') || {};
    const reader = feedConfig.reader || {};
    return {
      unreadPerSource: reader.unread_per_source ?? FreshRSSSourceAdapter.#DEFAULT_UNREAD_PER_SOURCE,
      totalLimit: reader.total_limit ?? FreshRSSSourceAdapter.#DEFAULT_TOTAL_LIMIT,
    };
  }

  async fetchPage(query, username, { cursor } = {}) {
    if (!this.#freshRSSAdapter) return { items: [], cursor: null };

    const { unreadPerSource, totalLimit } = this.#getReaderConfig();
    const streamId = 'user/-/state/com.google/reading-list';

    // Pass 1: unread items (prioritized)
    const { items: unreadRaw, continuation } = await this.#freshRSSAdapter.getItems(
      streamId, username, {
        excludeRead: true,
        count: unreadPerSource,
        continuation: cursor || undefined,
      }
    );

    const unreadIds = new Set(unreadRaw.map(i => i.id));
    const unreadItems = unreadRaw.map(item => this.#normalize(item, query, false));

    // If unread fills the limit, skip pass 2
    if (unreadItems.length >= totalLimit) {
      return { items: unreadItems.slice(0, totalLimit), cursor: continuation || null };
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
    return { items: merged, cursor: continuation || null };
  }

  #normalize(item, query, isRead) {
    return {
      id: `freshrss:${item.id}`,
      tier: query.tier || 'wire',
      source: 'freshrss',
      title: item.title,
      body: item.content ? item.content.replace(/<[^>]*>/g, '').slice(0, 200) : null,
      image: this.#extractImage(item.content),
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
