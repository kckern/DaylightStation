// backend/src/1_adapters/feed/sources/EntropyFeedAdapter.mjs
/**
 * EntropyFeedAdapter
 *
 * Fetches data-freshness (entropy) items from EntropyService and normalizes
 * them to FeedItem shape. No pagination (returns all items at once).
 *
 * Extracted from FeedPoolManager#fetchEntropy() to follow the standard
 * IFeedSourceAdapter pattern.
 *
 * @module adapters/feed/sources/EntropyFeedAdapter
 */

import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class EntropyFeedAdapter extends IFeedSourceAdapter {
  #entropyService;
  #logger;

  constructor({ entropyService, logger = console }) {
    super();
    this.#entropyService = entropyService;
    this.#logger = logger;
  }

  get sourceType() { return 'entropy'; }
  get provides() { return [CONTENT_TYPES.ENTROPY]; }

  async fetchPage(query, username, { cursor } = {}) {
    if (!this.#entropyService) return { items: [], cursor: null };
    const report = await this.#entropyService.getReport(username);
    let items = report.items || [];
    if (query.params?.onlyYellowRed) {
      items = items.filter(item => item.status === 'yellow' || item.status === 'red');
    }
    const normalized = items.map(item => ({
      id: `entropy:${item.source}`,
      tier: query.tier || 'compass',
      source: 'entropy',
      title: item.name || item.source,
      body: item.label || `${item.value} since last update`,
      image: null,
      link: item.url || null,
      timestamp: item.lastUpdate || new Date().toISOString(),
      priority: query.priority || 20,
      meta: { status: item.status, icon: item.icon, value: item.value, weight: item.weight, sourceName: 'Data Freshness', sourceIcon: null },
    }));
    return { items: normalized, cursor: null };
  }
}
