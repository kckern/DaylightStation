// backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs
/**
 * PlexFeedAdapter
 *
 * Fetches Plex media items via ContentRegistry (children mode)
 * or IContentQueryPort (search mode) and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/PlexFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class PlexFeedAdapter extends IFeedSourceAdapter {
  #contentRegistry;
  #contentQueryPort;
  #logger;

  #webUrl;

  constructor({ contentRegistry = null, contentQueryPort = null, webUrl = null, logger = console }) {
    super();
    this.#contentRegistry = contentRegistry;
    this.#contentQueryPort = contentQueryPort;
    this.#webUrl = webUrl;
    this.#logger = logger;
  }

  get sourceType() { return 'plex'; }

  async fetchItems(query, _username) {
    const plexAdapter = this.#contentRegistry?.get('plex');
    if (!plexAdapter && !this.#contentQueryPort) return [];

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
        tier: query.tier || 'compass',
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
    if (!this.#contentQueryPort) return [];
    const searchTerms = query.params?.search || ['new', 'recent'];
    const terms = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
    const term = terms[Math.floor(Math.random() * terms.length)];

    const result = await this.#contentQueryPort.search({
      text: `plex:${term}`,
      take: query.limit || 3,
    });

    return (result.items || []).map(item => {
      const localId = item.localId || item.id?.replace?.('plex:', '') || item.id;
      return {
        id: `plex:${localId}`,
        tier: query.tier || 'compass',
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

  async getDetail(localId, meta, _username) {
    const sections = [];

    sections.push({ type: 'player', data: { contentId: `plex:${localId}` } });

    const items = [];
    if (meta.type) items.push({ label: 'Type', value: meta.type });
    if (meta.year) items.push({ label: 'Year', value: String(meta.year) });
    if (items.length > 0) sections.push({ type: 'metadata', data: { items } });

    return { sections };
  }

  #plexWebLink(ratingKey) {
    if (!this.#webUrl) return null;
    return `${this.#webUrl}/web/index.html#!/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
  }
}
