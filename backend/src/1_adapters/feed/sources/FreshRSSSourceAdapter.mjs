// backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs
/**
 * FreshRSSSourceAdapter
 *
 * Fetches RSS items from FreshRSS via the underlying FreshRSS API adapter
 * and normalizes them to FeedItem shape.
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
  #logger;

  constructor({ freshRSSAdapter, logger = console }) {
    super();
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#logger = logger;
  }

  get sourceType() { return 'freshrss'; }

  async fetchPage(query, username, { cursor } = {}) {
    if (!this.#freshRSSAdapter) return { items: [], cursor: null };
    const { items: rawItems, continuation } = await this.#freshRSSAdapter.getItems(
      'user/-/state/com.google/reading-list',
      username,
      {
        excludeRead: query.params?.excludeRead ?? true,
        count: query.limit || 20,
        continuation: cursor || undefined,
      }
    );
    const items = (rawItems || []).map(item => ({
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
      },
    }));
    return { items, cursor: continuation || null };
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
