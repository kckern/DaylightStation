// backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs
/**
 * GratitudeFeedAdapter
 *
 * Reads gratitude selections from DataService and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/GratitudeFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class GratitudeFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) throw new Error('GratitudeFeedAdapter requires dataService');
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'gratitude'; }

  async fetchItems(query, _username) {
    try {
      // Must include .yml explicitly — dotted filename confuses DataService.ensureExtension()
      const data = this.#dataService.household.read('common/gratitude/selections.gratitude.yml');
      if (!data || !Array.isArray(data)) return [];

      const limit = query.limit || 1;
      const shuffled = [...data].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, limit).map((entry, i) => {
        const text = entry.item?.text || (typeof entry.item === 'string' ? entry.item : null) || entry.text || '';
        return {
          id: `gratitude:${entry.id || i}`,
          tier: query.tier || 'compass',
          source: 'gratitude',
          title: 'Gratitude',
          body: text,
          image: null,
          link: null,
          timestamp: entry.datetime || new Date().toISOString(),
          priority: query.priority || 5,
          meta: { category: 'gratitude', userId: entry.userId, sourceName: 'Gratitude', sourceIcon: null },
        };
      });
    } catch (err) {
      this.#logger.warn?.('gratitude.adapter.error', { error: err.message });
      return [];
    }
  }
}
