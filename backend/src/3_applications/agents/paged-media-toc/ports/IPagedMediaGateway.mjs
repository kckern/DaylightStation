// backend/src/3_applications/agents/paged-media-toc/ports/IPagedMediaGateway.mjs

/**
 * IPagedMediaGateway — port interface for accessing paged media (magazines, comics).
 *
 * Abstracts how the agent discovers books and fetches page images,
 * independent of the backing media server.
 *
 * @module applications/agents/paged-media-toc/ports/IPagedMediaGateway
 */
export class IPagedMediaGateway {
  /**
   * Fetch recent books/issues for a series, sorted newest-first.
   * @param {string} seriesId
   * @param {number} limit - Max books to return
   * @returns {Promise<Array<{id: string, title: string, pageCount: number}>>}
   */
  async getRecentBooks(seriesId, limit) {
    throw new Error('IPagedMediaGateway.getRecentBooks must be implemented');
  }

  /**
   * Fetch a page thumbnail as a base64 data URI (cheap, for detection).
   * @param {string} bookId
   * @param {number} page - 1-indexed page number
   * @returns {Promise<{imageDataUri: string, sizeBytes: number}>}
   */
  async getPageThumbnail(bookId, page) {
    throw new Error('IPagedMediaGateway.getPageThumbnail must be implemented');
  }

  /**
   * Fetch a full-resolution page image as a base64 data URI (for extraction).
   * @param {string} bookId
   * @param {number} page - 1-indexed page number
   * @returns {Promise<{imageDataUri: string, sizeBytes: number}>}
   */
  async getPageImage(bookId, page) {
    throw new Error('IPagedMediaGateway.getPageImage must be implemented');
  }
}

export function isPagedMediaGateway(obj) {
  return obj &&
    typeof obj.getRecentBooks === 'function' &&
    typeof obj.getPageThumbnail === 'function' &&
    typeof obj.getPageImage === 'function';
}
