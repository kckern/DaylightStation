// backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs
/**
 * ImmichFeedAdapter
 *
 * Fetches random photos from Immich via ContentQueryService and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/ImmichFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class ImmichFeedAdapter extends IFeedSourceAdapter {
  #contentQueryService;
  #logger;

  constructor({ contentQueryService, logger = console }) {
    super();
    if (!contentQueryService) throw new Error('ImmichFeedAdapter requires contentQueryService');
    this.#contentQueryService = contentQueryService;
    this.#logger = logger;
  }

  get sourceType() { return 'immich'; }

  async fetchItems(query, _username) {
    try {
      const result = await this.#contentQueryService.search({
        text: '',
        source: 'immich',
        take: query.limit || 3,
        sort: 'random',
      });
      return (result.items || []).map(item => {
        const localId = item.localId || item.id?.replace?.('immich:', '') || item.id;
        const created = item.metadata?.capturedAt || item.metadata?.createdAt || null;
        const yearsAgo = created
          ? Math.floor((Date.now() - new Date(created).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
          : null;
        return {
          id: `immich:${localId}`,
          type: query.feed_type || 'grounding',
          source: 'photo',
          title: yearsAgo ? `${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago` : 'Memory',
          body: item.metadata?.location || null,
          image: item.thumbnail || `/api/v1/proxy/immich/assets/${localId}/thumbnail`,
          link: null,
          timestamp: created || new Date().toISOString(),
          priority: query.priority || 5,
          meta: {
            yearsAgo,
            location: item.metadata?.location || null,
            originalDate: created,
            sourceName: 'Photos',
            sourceIcon: null,
          },
        };
      });
    } catch (err) {
      this.#logger.warn?.('immich.adapter.error', { error: err.message });
      return [];
    }
  }
}
