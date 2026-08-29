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
 * - Windowed pagination over normalized catalog results
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
  #contentCatalog;
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.contentCatalog - Semantic content catalog gateway
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ contentCatalog, logger = console }) {
    if (!contentCatalog?.resolveSiblings) {
      throw new Error('SiblingsService requires contentCatalog');
    }
    this.#contentCatalog = contentCatalog;
    this.#logger = logger;
  }

  /**
   * Resolve siblings for a given source and local ID.
   *
   * Resolution:
   * 1. Resolve adapter from registry (exact match, then prefix fallback)
   * 2. Delegate to adapter.resolveSiblings(compoundId)
   * 3. Apply windowed pagination (adapter controls item ordering)
   * 4. Return the catalog's uniform sibling DTOs
   *
   * @param {string} source - Source identifier
   * @param {string} localId - Local ID within source
   * @param {Object} [opts] - Pagination options
   * @param {number} [opts.offset] - Start offset for pagination
   * @param {number} [opts.limit] - Number of items to return
   * @returns {Promise<import('../ports/ISiblingsService.mjs').SiblingsResult|import('../ports/ISiblingsService.mjs').SiblingsError>}
   */
  async resolveSiblings(source, localId, opts = {}) {
    const resolution = this.#resolveAddress(source, localId);
    if (!resolution.address) return { kind: 'source_unknown', source };

    const { address, compoundId } = resolution;

    const result = await this.#contentCatalog.resolveSiblings(address, compoundId);
    if (result === null) {
      return { parent: null, items: [] };
    }

    // Apply windowed pagination (adapter controls item ordering)
    const windowed = this.#applyWindow(result.items || [], compoundId, opts);

    return {
      kind: 'resolved',
      parent: result.parent || null,
      items: windowed.items,
      referenceIndex: windowed.referenceIndex,
      pagination: windowed.pagination,
      // Pass the adapter's root-first breadcrumb chain through when present.
      // Adapters return well-formed crumbs; omit entirely when absent.
      ...(Array.isArray(result.ancestors) && result.ancestors.length && { ancestors: result.ancestors })
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
  #resolveAddress(source, localId) {
    const exact = this.#contentCatalog.hasSource(source);
    const address = this.#contentCatalog.resolveSource(source, localId);
    if (!address) return { address: null };
    const compoundId = exact ? `${source}:${address.localId}` : address.localId;
    return { address, compoundId };
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

}

export default SiblingsService;
