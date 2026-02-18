// backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs
/**
 * GratitudeFeedAdapter
 *
 * Reads gratitude selections from DataService and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/GratitudeFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class GratitudeFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #userService;
  #logger;

  constructor({ dataService, userService, logger = console }) {
    super();
    if (!dataService) throw new Error('GratitudeFeedAdapter requires dataService');
    this.#dataService = dataService;
    this.#userService = userService;
    this.#logger = logger;
  }

  get sourceType() { return 'gratitude'; }
  get provides() { return [CONTENT_TYPES.GRATITUDE]; }

  async fetchItems(query, _username) {
    try {
      // Must include .yml explicitly — dotted filename confuses DataService.ensureExtension()
      const data = this.#dataService.household.read('common/gratitude/selections.gratitude.yml');
      if (!data || !Array.isArray(data)) return [];

      const limit = Math.min(query.limit || 3, 3);
      const shuffled = [...data].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, limit);

      // Build sub-items with submitter info
      const items = picked.map(entry => {
        const text = entry.item?.text || (typeof entry.item === 'string' ? entry.item : null) || entry.text || '';
        const userId = entry.userId || null;
        const displayName = userId && this.#userService
          ? this.#userService.resolveGroupLabel(userId)
          : userId || '';
        return { text, userId, displayName };
      });

      // Use the most recent entry's timestamp
      const latestTs = picked.reduce((best, e) => {
        const t = e.datetime || '';
        return t > best ? t : best;
      }, '') || new Date().toISOString();

      return [{
        id: `gratitude:bundle:${Date.now()}`,
        tier: query.tier || 'compass',
        source: 'gratitude',
        title: 'Gratitude',
        body: items[0]?.text || '',
        image: null,
        link: null,
        timestamp: latestTs,
        priority: query.priority || 5,
        meta: {
          category: 'gratitude',
          sourceName: 'Gratitude',
          sourceIcon: null,
          items,
        },
      }];
    } catch (err) {
      this.#logger.warn?.('gratitude.adapter.error', { error: err.message });
      return [];
    }
  }
}
