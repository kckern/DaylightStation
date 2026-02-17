// backend/src/1_adapters/feed/sources/ReadalongFeedAdapter.mjs
/**
 * ReadalongFeedAdapter
 *
 * Delegates to the existing ReadalongAdapter (content adapter) to surface
 * the next unread chapter as a feed card.  No external API calls — all data
 * comes from local content + progress tracking.
 *
 * @module adapters/feed/sources/ReadalongFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class ReadalongFeedAdapter extends IFeedSourceAdapter {
  #readalongAdapter;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.readalongAdapter - ReadalongAdapter instance (content adapter)
   * @param {Object} [deps.logger]
   */
  constructor({ readalongAdapter, logger = console }) {
    super();
    if (!readalongAdapter) throw new Error('ReadalongFeedAdapter requires readalongAdapter');
    this.#readalongAdapter = readalongAdapter;
    this.#logger = logger;
  }

  get sourceType() { return 'readalong'; }

  /**
   * Fetch the next unread chapter for a given collection/volume.
   *
   * @param {Object} query - Query config from YAML
   * @param {string} query.params.collection - e.g., 'scripture'
   * @param {string} query.params.volume - e.g., 'bom'
   * @param {string} username
   * @returns {Promise<Object[]>} Single-element array with the FeedItem, or []
   */
  async fetchItems(query, _username) {
    const collection = query.params?.collection;
    const volume = query.params?.volume;
    if (!collection || !volume) {
      this.#logger.warn?.('readalong.feed.missing_params', { collection, volume });
      return [];
    }

    try {

      const localId = `${collection}/${volume}`;
      const item = await this.#readalongAdapter.getItem(localId);
      if (!item) return [];

      // Extract heading from first content block
      const firstBlock = item.content?.data?.[0];
      const heading = firstBlock?.headings?.heading
        || firstBlock?.headings?.summary
        || null;

      return [{
        id: item.id,
        tier: query.tier || 'compass',
        source: 'readalong',
        title: item.title || localId,
        body: heading,
        image: item.thumbnail || null,
        link: null,
        timestamp: new Date().toISOString(),
        priority: query.priority || 5,
        meta: {
          collection,
          volume,
          contentId: item.id,
          audioUrl: item.mediaUrl || null,
          duration: item.duration || 0,
          subtitle: item.subtitle || null,
          sourceName: collection.charAt(0).toUpperCase() + collection.slice(1),
          sourceIcon: item.thumbnail || null,
        },
      }];
    } catch (err) {
      this.#logger.warn?.('readalong.feed.error', { error: err.message });
      return [];
    }
  }

  /**
   * Fetch detail sections for a readalong item.
   *
   * @param {string} localId - Local portion of the item ID
   * @param {Object} meta - Item meta from the scroll response
   * @param {string} username
   * @returns {Promise<{ sections: Array<{ type: string, data: Object }> } | null>}
   */
  async getDetail(localId, meta, _username) {
    try {
      const compoundId = meta?.contentId || `readalong:${localId}`;
      const item = await this.#readalongAdapter.getItem(compoundId);
      if (!item) return null;

      const sections = [];

      if (item.mediaUrl) {
        sections.push({ type: 'player', data: { contentId: item.id } });
      }

      if (item.content?.data) {
        sections.push({ type: 'scripture', data: { blocks: item.content.data, contentType: item.content.type } });
      }

      return sections.length > 0 ? { sections } : null;
    } catch (err) {
      this.#logger.warn?.('readalong.detail.error', { error: err.message, localId });
      return null;
    }
  }
}
