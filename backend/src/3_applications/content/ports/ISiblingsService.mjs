// backend/src/3_applications/content/ports/ISiblingsService.mjs

/**
 * Port interface for sibling resolution service.
 * Defines the contract for resolving content siblings across different sources.
 * 
 * @module ISiblingsService
 */

/**
 * @typedef {Object} SiblingItem
 * @property {string} id - Compound ID (e.g., "plex:12345")
 * @property {string} title - Item title
 * @property {string|null} source - Source identifier
 * @property {string|null} type - Content type (show, movie, album, etc.)
 * @property {string|null} thumbnail - Thumbnail URL
 * @property {string|null} parentTitle - Parent container title
 * @property {string|null} grandparentTitle - Grandparent container title
 * @property {string|null} libraryTitle - Library section title
 * @property {number|null} childCount - Number of children if container
 * @property {boolean} isContainer - Whether item contains other items
 */

/**
 * @typedef {Object} SiblingParent
 * @property {string} id - Parent compound ID
 * @property {string} title - Parent title
 * @property {string|null} source - Source identifier
 * @property {string|null} thumbnail - Thumbnail URL
 * @property {string|null} parentId - Parent's parent ID (for breadcrumb navigation)
 * @property {string|null} libraryId - Library section ID
 */

/**
 * @typedef {Object} PaginationInfo
 * @property {number} total - Total number of sibling items
 * @property {number} offset - Start offset of current window
 * @property {number} window - Number of items in current window
 * @property {boolean} hasBefore - Whether there are items before current window
 * @property {boolean} hasAfter - Whether there are items after current window
 */

/**
 * @typedef {Object} SiblingsResult
 * @property {SiblingParent|null} parent - Parent container info
 * @property {SiblingItem[]} items - Sibling items
 * @property {number} [referenceIndex] - Index of reference item within the window
 * @property {PaginationInfo} [pagination] - Pagination metadata
 */

/**
 * @typedef {Object} SiblingsError
 * @property {string} error - Error message
 * @property {number} status - HTTP status code
 * @property {string} [source] - Source that failed
 * @property {string} [localId] - Local ID that failed
 */

/**
 * Interface for siblings service.
 * Implementations must provide sibling resolution across content sources.
 */
export class ISiblingsService {
  /**
   * Resolve siblings for a given source and local ID.
   * 
   * @param {string} source - Source identifier (e.g., "plex", "files", "local-content")
   * @param {string} localId - Local ID within the source
   * @returns {Promise<SiblingsResult|SiblingsError>} Siblings result or error
   */
  async resolveSiblings(source, localId) {
    throw new Error('resolveSiblings must be implemented');
  }
}

/**
 * Optional capability on IContentSource adapters.
 * Adapters that implement this method own their sibling resolution strategy.
 * Return null to fall back to the default algorithm (getItem → parent metadata → getList).
 * 
 * @typedef {Object} ISiblingsCapable
 * @property {function(string): Promise<SiblingsResult|null>} resolveSiblings
 */

/**
 * Validates that an object implements ISiblingsService.
 * @param {any} service
 * @throws {Error} If validation fails
 */
export function validateSiblingsService(service) {
  if (typeof service.resolveSiblings !== 'function') {
    throw new Error('SiblingsService must implement resolveSiblings(source, localId): Promise<SiblingsResult>');
  }
}
