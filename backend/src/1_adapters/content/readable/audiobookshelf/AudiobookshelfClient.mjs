// backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Low-level Audiobookshelf API client for making authenticated requests.
 * Audiobookshelf is a self-hosted audiobook and podcast server.
 */
export class AudiobookshelfClient {
  #host;
  #token;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Audiobookshelf server URL (e.g., http://localhost:13378)
   * @param {string} config.token - Audiobookshelf API token (Bearer token)
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('AudiobookshelfClient requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.token) {
      throw new InfrastructureError('AudiobookshelfClient requires token', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'token'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('AudiobookshelfClient requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.#host = config.host.replace(/\/$/, '');
    this.#token = config.token;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  get host() {
    return this.#host;
  }

  /**
   * Get default headers for Audiobookshelf API
   * @returns {Object}
   */
  #getHeaders() {
    return {
      'Authorization': `Bearer ${this.#token}`,
      'Accept': 'application/json'
    };
  }

  /**
   * Get all libraries
   * @returns {Promise<{libraries: Array}>}
   */
  async getLibraries() {
    const response = await this.#httpClient.get(
      `${this.#host}/api/libraries`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get items in a library with pagination, filtering, and sorting
   * @param {string} libraryId - Library ID
   * @param {Object} [options]
   * @param {number} [options.page=0] - Page number (0-indexed)
   * @param {number} [options.limit=50] - Page size
   * @param {string} [options.filter] - ABS filter string (e.g., 'genres.BASE64')
   * @param {string} [options.sort] - Sort field (e.g., 'media.metadata.title')
   * @param {boolean} [options.desc] - Sort descending when true
   * @returns {Promise<{results: Array, total: number, page: number, limit: number}>}
   */
  async getLibraryItems(libraryId, options = {}) {
    const page = options.page ?? 0;
    const limit = options.limit ?? 50;

    const params = new URLSearchParams({ page, limit });
    if (options.filter) params.set('filter', options.filter);
    if (options.sort) params.set('sort', options.sort);
    if (options.desc != null) params.set('desc', options.desc ? '1' : '0');

    const response = await this.#httpClient.get(
      `${this.#host}/api/libraries/${libraryId}/items?${params}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get a single item by ID with expanded details
   * @param {string} itemId - Item ID
   * @returns {Promise<Object>}
   */
  async getItem(itemId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/items/${itemId}?expanded=1`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get user progress for an item
   * @param {string} itemId - Item ID
   * @returns {Promise<Object>}
   */
  async getProgress(itemId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/me/progress/${itemId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Update progress for an item (audiobook or ebook)
   * @param {string} itemId - Item ID
   * @param {Object} progress - Progress data
   * @param {number} [progress.currentTime] - Current time in seconds (for audiobooks)
   * @param {number} [progress.ebookProgress] - Progress fraction 0-1 (for ebooks)
   * @param {boolean} [progress.isFinished] - Whether the item is finished
   * @returns {Promise<Object>}
   */
  async updateProgress(itemId, progress) {
    const response = await this.#httpClient.patch(
      `${this.#host}/api/me/progress/${itemId}`,
      progress,
      {
        headers: {
          ...this.#getHeaders(),
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  }

  /**
   * Get all authors in a library
   * @param {string} libraryId - Library ID
   * @returns {Promise<{authors: Array}>}
   */
  async getAuthors(libraryId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/libraries/${libraryId}/authors`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get a specific author by ID
   * @param {string} authorId - Author ID
   * @returns {Promise<Object>}
   */
  async getAuthor(authorId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/authors/${authorId}?include=items`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Check if an item is an ebook
   * @param {Object} item - Audiobookshelf item
   * @returns {boolean}
   */
  isEbook(item) {
    return Boolean(item?.media?.ebookFile);
  }

  /**
   * Check if an item is an audiobook
   * @param {Object} item - Audiobookshelf item
   * @returns {boolean}
   */
  isAudiobook(item) {
    return (item?.media?.numAudioFiles ?? 0) > 0;
  }
}

export default AudiobookshelfClient;
