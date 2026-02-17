/**
 * IContentQueryPort
 *
 * Interface for querying content across registered sources.
 * Adapters depend on this port instead of the concrete ContentQueryService.
 *
 * @module applications/feed/ports
 */

/**
 * @interface IContentQueryPort
 */
export class IContentQueryPort {
  /**
   * Search for content items across registered sources.
   *
   * @param {Object} params - Search parameters (text, source, take, sort, etc.)
   * @returns {Promise<{ items: Array<Object> }>} Search result with items array
   */
  async search(params) {
    throw new Error('Not implemented');
  }
}

export default IContentQueryPort;
