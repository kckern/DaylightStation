// backend/src/domains/content/services/ContentSourceRegistry.mjs
import { validateAdapter } from '#apps/content/ports/IContentSource.mjs';

/**
 * Registry for content source adapters.
 * Provides lookup by source name, prefix, category, and provider.
 */
export class ContentSourceRegistry {
  /** @type {Map<string, {adapter: any, category?: string, provider?: string}>} */
  #adapterEntries = new Map();

  /** @type {Map<string, {adapter: any, transform?: function}>} */
  #prefixMap = new Map();

  /** @type {Map<string, string[]>} category → [sources] */
  #categoryIndex = new Map();

  /** @type {Map<string, string[]>} provider → [sources] */
  #providerIndex = new Map();

  constructor() {
    // Legacy public property for backward compatibility
    this.adapters = new Map();
    this.prefixMap = this.#prefixMap;
  }

  /**
   * Register an adapter with optional metadata
   * @param {import('../../../3_applications/content/ports/IContentSource.mjs').IContentSource} adapter
   * @param {Object} [metadata] - Optional metadata from manifest
   * @param {string} [metadata.category] - Content category (gallery, media, readable)
   * @param {string} [metadata.provider] - Provider name (immich, plex, abs)
   */
  register(adapter, metadata = {}) {
    validateAdapter(adapter);

    const source = adapter.source;
    const { category, provider } = metadata;

    // Store adapter with metadata
    this.#adapterEntries.set(source, { adapter, category, provider });

    // Legacy: also store in public adapters map for backward compatibility
    this.adapters.set(source, adapter);

    // Build prefix map from adapter's declared prefixes
    for (const mapping of adapter.prefixes) {
      this.#prefixMap.set(mapping.prefix, {
        adapter,
        transform: mapping.idTransform
      });
    }

    // Index by category if provided
    if (category) {
      if (!this.#categoryIndex.has(category)) {
        this.#categoryIndex.set(category, []);
      }
      this.#categoryIndex.get(category).push(source);
    }

    // Index by provider if provided
    if (provider) {
      if (!this.#providerIndex.has(provider)) {
        this.#providerIndex.set(provider, []);
      }
      this.#providerIndex.get(provider).push(source);
    }
  }

  /**
   * Get adapter by source name
   * @param {string} source
   * @returns {import('../../../3_applications/content/ports/IContentSource.mjs').IContentSource|undefined}
   */
  get(source) {
    const entry = this.#adapterEntries.get(source);
    return entry?.adapter;
  }

  /**
   * Get adapter entry with metadata by source name
   * @param {string} source
   * @returns {{adapter: any, category?: string, provider?: string}|undefined}
   */
  getEntry(source) {
    return this.#adapterEntries.get(source);
  }

  /**
   * Resolve source param to adapter list.
   * Priority: exact source → provider → category → all
   * @param {string} [sourceParam] - Source filter (source name, provider, or category)
   * @returns {Array} Array of adapters matching the filter
   */
  resolveSource(sourceParam) {
    if (!sourceParam) {
      return this.#allAdapters();
    }

    // 1. Exact source match
    const exact = this.#adapterEntries.get(sourceParam);
    if (exact) {
      return [exact.adapter];
    }

    // 2. Provider match (e.g., "immich" → all immich instances)
    const byProvider = this.#providerIndex.get(sourceParam);
    if (byProvider?.length) {
      return byProvider.map(s => this.#adapterEntries.get(s).adapter);
    }

    // 3. Category match (e.g., "gallery" → all gallery sources)
    const byCategory = this.#categoryIndex.get(sourceParam);
    if (byCategory?.length) {
      return byCategory.map(s => this.#adapterEntries.get(s).adapter);
    }

    return [];
  }

  /**
   * Get all adapters for a category
   * @param {string} category
   * @returns {Array}
   */
  getByCategory(category) {
    const sources = this.#categoryIndex.get(category) || [];
    return sources.map(s => this.#adapterEntries.get(s).adapter);
  }

  /**
   * Get all adapters for a provider
   * @param {string} provider
   * @returns {Array}
   */
  getByProvider(provider) {
    const sources = this.#providerIndex.get(provider) || [];
    return sources.map(s => this.#adapterEntries.get(s).adapter);
  }

  /**
   * Get all registered categories
   * @returns {string[]}
   */
  getCategories() {
    return Array.from(this.#categoryIndex.keys());
  }

  /**
   * Get all registered providers
   * @returns {string[]}
   */
  getProviders() {
    return Array.from(this.#providerIndex.keys());
  }

  /**
   * Get all adapters
   * @returns {Array}
   * @private
   */
  #allAdapters() {
    return [...this.#adapterEntries.values()].map(e => e.adapter);
  }

  /**
   * Resolve from prefix (e.g., "media" → FilesystemAdapter)
   * @param {string} prefix
   * @param {string} value
   * @returns {{adapter: any, localId: string}|null}
   */
  resolveFromPrefix(prefix, value) {
    const entry = this.#prefixMap.get(prefix);
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
      const defaultAdapter = this.#adapterEntries.get('filesystem')?.adapter;
      return defaultAdapter ? { adapter: defaultAdapter, localId: compoundId } : null;
    }

    const source = compoundId.substring(0, colonIndex);
    const localId = compoundId.substring(colonIndex + 1);

    // First try exact source match
    const adapter = this.#adapterEntries.get(source)?.adapter;
    if (adapter) {
      return { adapter, localId };
    }

    // Fall back to prefix resolution
    return this.resolveFromPrefix(source, localId);
  }

  /**
   * Register legacy prefix aliases from config.
   * Maps legacy prefixes (e.g., "hymn") to canonical format (e.g., "singing:hymn").
   * @param {Object<string, string>} legacyMap - Map of legacy prefix to canonical format
   * @example
   * registry.registerLegacyPrefixes({
   *   hymn: 'singing:hymn',      // hymn:123 → singing adapter with localId hymn/123
   *   talk: 'narrated:talks'     // talk:foo → narrated adapter with localId talks/foo
   * });
   */
  registerLegacyPrefixes(legacyMap) {
    for (const [legacyPrefix, canonical] of Object.entries(legacyMap)) {
      // Parse canonical format: "source:pathPrefix" (e.g., "singing:hymn")
      const colonIndex = canonical.indexOf(':');
      if (colonIndex === -1) continue;

      const targetSource = canonical.substring(0, colonIndex);
      const pathPrefix = canonical.substring(colonIndex + 1);

      // Look up the target adapter
      const adapter = this.get(targetSource);
      if (!adapter) {
        console.warn(`[ContentSourceRegistry] Legacy prefix "${legacyPrefix}" targets unknown source "${targetSource}"`);
        continue;
      }

      // Register the legacy prefix with transform: id → pathPrefix/id
      this.#prefixMap.set(legacyPrefix, {
        adapter,
        transform: (id) => `${pathPrefix}/${id}`
      });
    }
  }

  /**
   * List all registered prefixes
   * @returns {string[]}
   */
  getRegisteredPrefixes() {
    return Array.from(this.#prefixMap.keys());
  }

  /**
   * List all registered source names
   * @returns {string[]}
   */
  list() {
    return Array.from(this.#adapterEntries.keys());
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

export default ContentSourceRegistry;
