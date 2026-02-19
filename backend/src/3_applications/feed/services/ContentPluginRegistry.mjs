/**
 * ContentPluginRegistry
 *
 * Post-processing enrichment layer for normalized feed items.
 * Iterates registered IContentPlugin instances; first match wins.
 * Items with an existing `contentType` or whose `source` matches
 * a plugin's contentType are skipped (already enriched).
 *
 * @module applications/feed/services
 */
export class ContentPluginRegistry {
  /** @type {Array<import('../plugins/IContentPlugin.mjs').IContentPlugin>} */
  #plugins;

  /**
   * @param {Array<import('../plugins/IContentPlugin.mjs').IContentPlugin>} plugins
   */
  constructor(plugins = []) {
    this.#plugins = plugins;
  }

  /**
   * Enrich items in-place. Returns the same array for convenience.
   * @param {Object[]} items - Normalized feed items
   * @returns {Object[]}
   */
  enrich(items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Skip already-typed items
      if (item.contentType) continue;

      for (const plugin of this.#plugins) {
        // Skip if item.source already matches this plugin (e.g., source:'youtube')
        if (item.source === plugin.contentType) break;

        if (plugin.detect(item)) {
          const enrichment = plugin.enrich(item);
          const { meta: enrichedMeta, ...rest } = enrichment;
          Object.assign(item, rest);
          if (enrichedMeta) {
            item.meta = { ...item.meta, ...enrichedMeta };
          }
          break; // first match wins
        }
      }
    }
    return items;
  }
}
