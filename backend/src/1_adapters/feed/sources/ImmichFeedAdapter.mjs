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
  #webUrl;
  #logger;

  constructor({ contentQueryService, webUrl = null, logger = console }) {
    super();
    if (!contentQueryService) throw new Error('ImmichFeedAdapter requires contentQueryService');
    this.#contentQueryService = contentQueryService;
    this.#webUrl = webUrl;
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
        const location = item.metadata?.location || null;
        return {
          id: `immich:${localId}`,
          type: query.feed_type || 'grounding',
          source: 'photo',
          title: created ? this.#formatDate(created) : 'Memory',
          body: location,
          image: item.thumbnail || `/api/v1/proxy/immich/assets/${localId}/original`,
          link: this.#webUrl ? `${this.#webUrl}/photos/${localId}` : null,
          timestamp: created || new Date().toISOString(),
          priority: query.priority || 5,
          meta: {
            location,
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

  #formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Memory';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = days[d.getDay()];
    const date = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    return `${day} ${date} ${month}, ${year} ${hours}:${mins}${ampm}`;
  }
}
