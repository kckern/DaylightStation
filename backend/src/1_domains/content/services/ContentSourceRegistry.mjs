// backend/src/domains/content/services/ContentSourceRegistry.mjs
import { validateAdapter } from '../../../3_applications/content/ports/IContentSource.mjs';

/**
 * Registry for content source adapters.
 * Provides lookup by source name and prefix resolution.
 */
export class ContentSourceRegistry {
  constructor() {
    /** @type {Map<string, import('../../../3_applications/content/ports/IContentSource.mjs').IContentSource>} */
    this.adapters = new Map();

    /** @type {Map<string, {adapter: any, transform?: function}>} */
    this.prefixMap = new Map();
  }

  /**
   * Register an adapter
   * @param {import('../../../3_applications/content/ports/IContentSource.mjs').IContentSource} adapter
   */
  register(adapter) {
    validateAdapter(adapter);

    this.adapters.set(adapter.source, adapter);

    // Build prefix map from adapter's declared prefixes
    for (const mapping of adapter.prefixes) {
      this.prefixMap.set(mapping.prefix, {
        adapter,
        transform: mapping.idTransform
      });
    }
  }

  /**
   * Get adapter by source name
   * @param {string} source
   * @returns {import('../../../3_applications/content/ports/IContentSource.mjs').IContentSource|undefined}
   */
  get(source) {
    return this.adapters.get(source);
  }

  /**
   * Resolve from prefix (e.g., "media" → FilesystemAdapter)
   * @param {string} prefix
   * @param {string} value
   * @returns {{adapter: any, localId: string}|null}
   */
  resolveFromPrefix(prefix, value) {
    const entry = this.prefixMap.get(prefix);
    if (!entry) return null;

    const localId = entry.transform ? entry.transform(value) : value;
    return { adapter: entry.adapter, localId };
  }

  /**
   * Resolve compound ID (e.g., "plex:12345")
   * @param {string} compoundId
   * @returns {{adapter: any, localId: string}|null}
   */
  resolve(compoundId) {
    const colonIndex = compoundId.indexOf(':');
    if (colonIndex === -1) {
      // No colon - treat as filesystem path (default adapter)
      const defaultAdapter = this.adapters.get('filesystem');
      return defaultAdapter ? { adapter: defaultAdapter, localId: compoundId } : null;
    }

    const source = compoundId.substring(0, colonIndex);
    const localId = compoundId.substring(colonIndex + 1);

    // First try exact source match
    const adapter = this.adapters.get(source);
    if (adapter) {
      return { adapter, localId };
    }

    // Fall back to prefix resolution
    return this.resolveFromPrefix(source, localId);
  }

  /**
   * List all registered prefixes
   * @returns {string[]}
   */
  getRegisteredPrefixes() {
    return Array.from(this.prefixMap.keys());
  }

  /**
   * Check if a compound ID can be resolved
   * @param {string} compoundId
   * @returns {boolean}
   */
  canResolve(compoundId) {
    return this.resolve(compoundId) !== null;
  }
}
