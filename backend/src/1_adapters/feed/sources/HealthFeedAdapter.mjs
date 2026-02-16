// backend/src/1_adapters/feed/sources/HealthFeedAdapter.mjs
/**
 * HealthFeedAdapter
 *
 * Reads user health/lifelog data and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/HealthFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class HealthFeedAdapter extends IFeedSourceAdapter {
  #userDataService;
  #logger;

  constructor({ userDataService, logger = console }) {
    super();
    if (!userDataService) throw new Error('HealthFeedAdapter requires userDataService');
    this.#userDataService = userDataService;
    this.#logger = logger;
  }

  get sourceType() { return 'health'; }

  async fetchItems(query, username) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = this.#userDataService.getLifelogData(username, 'health');
      if (!data) return [];

      const dayData = data[today] || Object.values(data).pop();
      if (!dayData) return [];

      return [{
        id: `health:${today}`,
        type: query.feed_type || 'grounding',
        source: 'health',
        title: 'Daily Health',
        body: this.#formatSummary(dayData),
        image: null,
        link: null,
        timestamp: new Date().toISOString(),
        priority: query.priority || 15,
        meta: { ...dayData, sourceName: 'Health', sourceIcon: null },
      }];
    } catch (err) {
      this.#logger.warn?.('health.adapter.error', { error: err.message });
      return [];
    }
  }

  #formatSummary(data) {
    const parts = [];
    if (data.weight?.lbs) parts.push(`${data.weight.lbs} lbs`);
    if (data.weight?.trend != null) {
      const sign = data.weight.trend > 0 ? '+' : '';
      parts.push(`${sign}${data.weight.trend} trend`);
    }
    if (data.steps) parts.push(`${data.steps} steps`);
    if (data.nutrition?.calories) parts.push(`${data.nutrition.calories} cal`);
    if (data.nutrition?.protein) parts.push(`${data.nutrition.protein}g protein`);
    return parts.join(' \u00b7 ') || 'No data';
  }
}
