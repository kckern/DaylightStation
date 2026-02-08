// backend/src/3_applications/content/services/SiblingsService.mjs

/**
 * SiblingsService
 *
 * Application layer service for resolving content siblings across sources.
 * Pure delegator — resolves the correct adapter via registry, then calls
 * adapter.resolveSiblings(). Each adapter owns its own sibling-finding strategy.
 *
 * Key responsibilities:
 * - Adapter resolution via ContentSourceRegistry (get + resolve fallback)
 * - Delegation to adapter.resolveSiblings()
 * - Response normalization (DTO mapping for uniform API shape)
 *
 * What this service does NOT own:
 * - Knowledge of specific content types (scripture volumes, list prefixes, etc.)
 * - Source-specific branching — zero if/else on adapter.source
 * - Metadata field knowledge — no parentRatingKey, librarySectionID, etc.
 *
 * @module SiblingsService
 */

/**
 * Application service for sibling resolution
 */
export class SiblingsService {
  #registry;
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} deps.registry - Content source registry
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ registry, logger = console }) {
    if (!registry) {
      throw new Error('SiblingsService requires registry');
    }
    this.#registry = registry;
    this.#logger = logger;
  }

  /**
   * Resolve siblings for a given source and local ID.
   *
   * Resolution:
   * 1. Resolve adapter from registry (exact match, then prefix fallback)
   * 2. Delegate to adapter.resolveSiblings(compoundId)
   * 3. Normalize result to uniform DTO shape
   *
   * @param {string} source - Source identifier
   * @param {string} localId - Local ID within source
   * @returns {Promise<import('../ports/ISiblingsService.mjs').SiblingsResult|import('../ports/ISiblingsService.mjs').SiblingsError>}
   */
  async resolveSiblings(source, localId) {
    const resolution = this.#resolveAdapter(source, localId);
    if (!resolution.adapter) {
      return { error: `Unknown source: ${source}`, status: 404, source };
    }

    const { adapter, compoundId } = resolution;

    const result = await adapter.resolveSiblings(compoundId);
    if (result === null) {
      return { parent: null, items: [] };
    }

    return this.#normalizeResult(result);
  }

  // ---------------------------------------------------------------------------
  // Adapter resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve adapter for source/localId via registry.
   * Tries exact source match first, then prefix-based resolution.
   * @private
   */
  #resolveAdapter(source, localId) {
    let adapter = this.#registry.get(source);
    let resolvedLocalId = localId;
    let resolvedViaPrefix = false;

    if (!adapter) {
      const resolved = this.#registry.resolve(`${source}:${localId}`);
      if (resolved) {
        adapter = resolved.adapter;
        resolvedLocalId = resolved.localId;
        resolvedViaPrefix = true;
      }
    }

    if (!adapter) {
      return { adapter: null };
    }

    const compoundId = resolvedViaPrefix ? resolvedLocalId : `${source}:${resolvedLocalId}`;

    return { adapter, compoundId };
  }

  // ---------------------------------------------------------------------------
  // Response normalization (DTO mapping)
  // ---------------------------------------------------------------------------

  /**
   * Normalize an adapter-provided SiblingsResult.
   * Applies mapSiblingItem to each item for consistent API response shape.
   * @private
   */
  #normalizeResult(result) {
    return {
      parent: result.parent || null,
      items: (result.items || []).map(item => this.#mapSiblingItem(item, { sourceOverride: result.sourceOverride }))
    };
  }

  /**
   * Map adapter item to uniform sibling item DTO.
   * This is presentation-layer normalization, not domain logic.
   * @private
   */
  #mapSiblingItem(item, options = {}) {
    const { sourceOverride } = options;
    const source = sourceOverride || item.source || item.id?.split(':')[0] || null;
    const type = item.metadata?.type || item.type || item.itemType || null;
    const thumbnail = item.thumbnail || item.image || item.imageUrl || null;
    const parentTitle = item.metadata?.parentTitle ?? item.parentTitle ?? null;
    const grandparentTitle = item.metadata?.grandparentTitle ?? item.grandparentTitle ?? null;
    const libraryTitle = item.metadata?.librarySectionTitle ?? item.librarySectionTitle ?? null;
    const childCount = item.metadata?.childCount ?? item.metadata?.leafCount ?? item.childCount ?? null;
    const isContainer = item.itemType === 'container' || item.isContainer || item.metadata?.type === 'container';

    return {
      id: item.id,
      title: item.title,
      source,
      type,
      thumbnail,
      parentTitle,
      grandparentTitle,
      libraryTitle,
      childCount,
      isContainer
    };
  }
}

export default SiblingsService;
