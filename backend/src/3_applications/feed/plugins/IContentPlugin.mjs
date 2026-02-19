/**
 * Content plugin interface.
 *
 * Plugins detect items by URL/metadata and enrich them with
 * content-type-specific fields. The ContentPluginRegistry runs
 * all registered plugins as a post-processing step.
 *
 * @module applications/feed/plugins
 */
export class IContentPlugin {
  /** @returns {string} Content type identifier, e.g. 'youtube' */
  get contentType() {
    throw new Error('IContentPlugin.contentType must be implemented');
  }

  /**
   * Test whether this plugin should handle the given item.
   * @param {Object} item - Normalized feed item
   * @returns {boolean}
   */
  detect(item) {
    return false;
  }

  /**
   * Return metadata to merge onto the item.
   * Called only when detect() returns true.
   * @param {Object} item - Normalized feed item
   * @returns {Object} Fields to shallow-merge onto item (may include nested `meta`)
   */
  enrich(item) {
    return {};
  }
}
