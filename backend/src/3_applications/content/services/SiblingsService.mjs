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
   * 3. Sort items alphabetically by title
   * 4. Apply windowed pagination
   * 5. Normalize result to uniform DTO shape
   *
   * @param {string} source - Source identifier
   * @param {string} localId - Local ID within source
   * @param {Object} [opts] - Pagination options
   * @param {number} [opts.offset] - Start offset for pagination
   * @param {number} [opts.limit] - Number of items to return
   * @returns {Promise<import('../ports/ISiblingsService.mjs').SiblingsResult|import('../ports/ISiblingsService.mjs').SiblingsError>}
   */
  async resolveSiblings(source, localId, opts = {}) {
    const resolution = this.#resolveAdapter(source, localId);
    if (!resolution.adapter) {
      return { error: `Unknown source: ${source}`, status: 404, source };
    }

    const { adapter, compoundId } = resolution;

    const result = await adapter.resolveSiblings(compoundId);
    if (result === null) {
      return { parent: null, items: [] };
    }

    // Sort items alphabetically by title
    const sortedItems = [...(result.items || [])].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '')
    );

    // Apply windowed pagination
    const windowed = this.#applyWindow(sortedItems, compoundId, opts);

    // Normalize windowed items
    const normalized = windowed.items.map(item =>
      this.#mapSiblingItem(item, { sourceOverride: result.sourceOverride })
    );

    return {
      parent: result.parent || null,
      items: normalized,
      referenceIndex: windowed.referenceIndex,
      pagination: windowed.pagination
    };
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
  // Windowed pagination
  // ---------------------------------------------------------------------------

  /**
   * Apply windowed pagination to a sorted list of items.
   *
   * Initial mode (no offset/limit): Centers a window of 21 items around the reference item.
   * Pagination mode (offset + limit): Returns a slice at the given offset.
   *
   * @param {Array} items - Sorted items array
   * @param {string} referenceId - Compound ID of the reference item (e.g., "plex:12345")
   * @param {Object} opts - { offset, limit }
   * @returns {{ items: Array, referenceIndex: number, pagination: Object }}
   * @private
   */
  #applyWindow(items, referenceId, opts) {
    const total = items.length;

    if (opts.offset != null && opts.limit != null) {
      // Pagination mode — explicit offset + limit
      const offset = Math.max(0, Math.min(opts.offset, total));
      const limit = Math.max(1, opts.limit);
      const sliced = items.slice(offset, offset + limit);

      return {
        items: sliced,
        referenceIndex: -1,
        pagination: {
          total,
          offset,
          window: sliced.length,
          hasBefore: offset > 0,
          hasAfter: offset + sliced.length < total
        }
      };
    }

    // Initial mode — center around reference item (10 above + ref + 10 below = 21)
    const halfWindow = 10;
    const refIdx = items.findIndex(item => {
      const id = item.id || `${item.source}:${item.localId}`;
      return id === referenceId || id === referenceId.replace(/^[^:]+:/, (m) => m);
    });

    if (refIdx === -1 || total <= (halfWindow * 2 + 1)) {
      // Reference not found or list fits in one window — return all
      return {
        items,
        referenceIndex: Math.max(refIdx, 0),
        pagination: {
          total,
          offset: 0,
          window: total,
          hasBefore: false,
          hasAfter: false
        }
      };
    }

    let start = refIdx - halfWindow;
    let end = refIdx + halfWindow + 1;

    // Clamp at edges
    if (start < 0) {
      end = Math.min(total, end - start);
      start = 0;
    }
    if (end > total) {
      start = Math.max(0, start - (end - total));
      end = total;
    }

    const sliced = items.slice(start, end);

    return {
      items: sliced,
      referenceIndex: refIdx - start,
      pagination: {
        total,
        offset: start,
        window: sliced.length,
        hasBefore: start > 0,
        hasAfter: end < total
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Response normalization (DTO mapping)
  // ---------------------------------------------------------------------------

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
      isContainer,
      ...(item.group && { group: item.group })
    };
  }
}

export default SiblingsService;
