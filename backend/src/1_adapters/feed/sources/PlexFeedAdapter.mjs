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
import { probeImageDimensions } from '#system/utils/probeImageDimensions.mjs';

export class PlexFeedAdapter extends IFeedSourceAdapter {
  #contentRegistry;
  #contentQueryPort;
  #logger;

  #webUrl;
  #plexHost;
  #plexToken;

  constructor({ contentRegistry = null, contentQueryPort = null, webUrl = null, plexHost = null, plexToken = null, logger = console }) {
    super();
    this.#contentRegistry = contentRegistry;
    this.#contentQueryPort = contentQueryPort;
    this.#webUrl = webUrl;
    this.#plexHost = plexHost;
    this.#plexToken = plexToken;
    this.#logger = logger;
  }

  get sourceType() { return 'plex'; }

  async fetchItems(query, _username) {
    const plexAdapter = this.#contentRegistry?.get('plex');
    if (!plexAdapter && !this.#contentQueryPort) return [];

    try {
      const mode = query.params?.mode || 'search';

      if (mode === 'children' && plexAdapter) {
        if (Array.isArray(query.params?.parentIds)) {
          return this.#fetchWeightedChildren(plexAdapter, query);
        }
        if (query.params?.parentId) {
          return this.#fetchChildren(plexAdapter, query);
        }
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
    return this.#mapItemsWithDims(filtered.slice(0, query.limit || 3), query, 'compass');
  }

  async #fetchWeightedChildren(plexAdapter, query) {
    const entries = query.params.parentIds;
    if (!entries.length) return [];
    const totalWeight = entries.reduce((sum, e) => sum + (e.weight || 1), 0);
    let roll = Math.random() * totalWeight;
    let selectedId = entries[0].id;
    for (const entry of entries) {
      roll -= (entry.weight || 1);
      if (roll <= 0) { selectedId = entry.id; break; }
    }

    const items = await plexAdapter.getList(String(selectedId));
    let filtered = items || [];

    if (query.params?.unwatched) {
      filtered = filtered.filter(item => {
        const vc = item.metadata?.viewCount ?? item.viewCount ?? 0;
        return vc === 0;
      });
    }

    filtered.sort(() => Math.random() - 0.5);
    return this.#mapItemsWithDims(filtered.slice(0, query.limit || 3), query, 'library');
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

    return this.#mapItemsWithDims(result.items || [], query, 'compass');
  }

  /**
   * Map raw Plex items to feed items, probing dimensions for the first few.
   * When the pool manager uses stripLimits (limit=10000), hundreds of items
   * may be returned; probing all of them concurrently causes timeouts.
   * Only the first MAX_PROBE items get dimensions; the rest are returned without.
   */
  async #mapItemsWithDims(rawItems, query, defaultTier) {
    const MAX_PROBE = 5;
    const toFeedItem = (item, dims = {}) => {
      const localId = item.localId || item.id?.replace?.('plex:', '') || item.id;
      return {
        id: `plex:${localId}`,
        tier: query.tier || defaultTier,
        source: 'plex',
        title: item.title || item.label || 'Media',
        body: item.subtitle || item.metadata?.artist || item.metadata?.parentTitle || item.description || null,
        image: item.thumbnail || null,
        link: this.#plexWebLink(localId),
        timestamp: item.metadata?.addedAt || new Date().toISOString(),
        priority: query.priority || 5,
        meta: {
          playable: true,
          duration: item.duration ?? null,
          type: item.type || item.metadata?.type,
          year: item.year || item.metadata?.year,
          artistName: item.metadata?.artist || item.metadata?.parentTitle || null,
          sourceName: item.metadata?.artist || item.metadata?.parentTitle || 'Plex',
          sourceIcon: null,
          ...dims,
        },
      };
    };

    // Probe first MAX_PROBE items, map the rest without probing
    const probed = await Promise.all(
      rawItems.slice(0, MAX_PROBE).map(async item => {
        const dims = await this.#getThumbDimensions(item.thumbnail);
        return toFeedItem(item, dims);
      })
    );
    const rest = rawItems.slice(MAX_PROBE).map(item => toFeedItem(item));
    return [...probed, ...rest];
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

  async #getThumbDimensions(thumbProxy) {
    if (!this.#plexHost || !thumbProxy) return {};
    try {
      // thumbProxy is like /api/v1/proxy/plex/library/metadata/123/thumb
      const plexPath = thumbProxy.replace(/^\/api\/v1\/proxy\/plex/, '');
      const separator = plexPath.includes('?') ? '&' : '?';
      const url = `${this.#plexHost}${plexPath}${separator}X-Plex-Token=${this.#plexToken}`;
      const dims = await probeImageDimensions(url, 8000);
      return dims ? { imageWidth: dims.width, imageHeight: dims.height } : {};
    } catch {
      return {};
    }
  }

  #plexWebLink(ratingKey) {
    if (!this.#webUrl) return null;
    return `${this.#webUrl}/web/index.html#!/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
  }
}
