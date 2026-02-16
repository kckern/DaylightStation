// backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs
/**
 * PlexFeedAdapter
 *
 * Fetches Plex media items via ContentRegistry (children mode)
 * or ContentQueryService (search mode) and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/PlexFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class PlexFeedAdapter extends IFeedSourceAdapter {
  #contentRegistry;
  #contentQueryService;
  #logger;

  #webUrl;

  constructor({ contentRegistry = null, contentQueryService = null, webUrl = null, logger = console }) {
    super();
    this.#contentRegistry = contentRegistry;
    this.#contentQueryService = contentQueryService;
    this.#webUrl = webUrl;
    this.#logger = logger;
  }

  get sourceType() { return 'plex'; }

  async fetchItems(query, _username) {
    const plexAdapter = this.#contentRegistry?.get('plex');
    if (!plexAdapter && !this.#contentQueryService) return [];

    try {
      const mode = query.params?.mode || 'search';

      if (mode === 'children' && plexAdapter && query.params?.parentId) {
        return this.#fetchChildren(plexAdapter, query);
      }

      return this.#fetchSearch(query);
    } catch (err) {
      this.#logger.warn?.('plex.adapter.error', { error: err.message });
      return [];
    }
  }

  async #fetchChildren(plexAdapter, query) {
    const items = await plexAdapter.getList(String(query.params.parentId));
    let filtered = items || [];

    if (query.params?.unwatched) {
      filtered = filtered.filter(item => {
        const vc = item.metadata?.viewCount ?? item.viewCount ?? 0;
        return vc === 0;
      });
    }

    filtered.sort(() => Math.random() - 0.5);
    return filtered.slice(0, query.limit || 3).map(item => {
      const localId = item.localId || item.id?.replace?.('plex:', '') || item.id;
      return {
        id: `plex:${localId}`,
        type: query.feed_type || 'grounding',
        source: 'plex',
        title: item.title || item.label || 'Media',
        body: item.subtitle || item.description || null,
        image: item.thumbnail || null,
        link: this.#plexWebLink(localId),
        timestamp: item.metadata?.addedAt || new Date().toISOString(),
        priority: query.priority || 5,
        meta: {
          type: item.type || item.metadata?.type,
          year: item.year || item.metadata?.year,
          sourceName: 'Plex',
          sourceIcon: null,
        },
      };
    });
  }

  async #fetchSearch(query) {
    if (!this.#contentQueryService) return [];
    const searchTerms = query.params?.search || ['new', 'recent'];
    const terms = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
    const term = terms[Math.floor(Math.random() * terms.length)];

    const result = await this.#contentQueryService.search({
      text: `plex:${term}`,
      take: query.limit || 3,
    });

    return (result.items || []).map(item => {
      const localId = item.localId || item.id?.replace?.('plex:', '') || item.id;
      return {
        id: `plex:${localId}`,
        type: query.feed_type || 'grounding',
        source: 'plex',
        title: item.title || item.label || 'Media',
        body: item.subtitle || item.description || null,
        image: item.thumbnail || null,
        link: this.#plexWebLink(localId),
        timestamp: item.metadata?.addedAt || new Date().toISOString(),
        priority: query.priority || 5,
        meta: {
          type: item.type || item.metadata?.type,
          year: item.year || item.metadata?.year,
          sourceName: 'Plex',
          sourceIcon: null,
        },
      };
    });
  }

  #plexWebLink(ratingKey) {
    if (!this.#webUrl) return null;
    return `${this.#webUrl}/web/index.html#!/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
  }
}
