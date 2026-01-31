// backend/src/1_adapters/content/readable/komga/KomgaClient.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Low-level Komga API client for making authenticated requests.
 * Komga is a media server for comics, manga, and other readable content.
 */
export class KomgaClient {
  #host;
  #apiKey;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Komga server URL (e.g., http://localhost:25600)
   * @param {string} config.apiKey - Komga API key
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('KomgaClient requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('KomgaClient requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('KomgaClient requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.#host = config.host.replace(/\/$/, '');
    this.#apiKey = config.apiKey;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  get host() {
    return this.#host;
  }

  /**
   * Get default headers for Komga API
   * @returns {Object}
   */
  #getHeaders() {
    return {
      'X-API-Key': this.#apiKey,
      'Accept': 'application/json'
    };
  }

  /**
   * Get all libraries
   * @returns {Promise<Array>}
   */
  async getLibraries() {
    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/libraries`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get series with pagination
   * @param {string} libraryId - Library ID to filter by
   * @param {Object} [options]
   * @param {number} [options.page=0] - Page number (0-indexed)
   * @param {number} [options.size=50] - Page size
   * @returns {Promise<{content: Array, totalPages: number, totalElements: number}>}
   */
  async getSeries(libraryId, options = {}) {
    const page = options.page ?? 0;
    const size = options.size ?? 50;

    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/series?library_id=${libraryId}&page=${page}&size=${size}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get books in a series with pagination
   * @param {string} seriesId - Series ID
   * @param {Object} [options]
   * @param {number} [options.page=0] - Page number (0-indexed)
   * @param {number} [options.size=50] - Page size
   * @returns {Promise<{content: Array, totalPages: number, totalElements: number}>}
   */
  async getBooks(seriesId, options = {}) {
    const page = options.page ?? 0;
    const size = options.size ?? 50;

    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/series/${seriesId}/books?page=${page}&size=${size}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get a single book by ID
   * @param {string} bookId - Book ID
   * @returns {Promise<Object>}
   */
  async getBook(bookId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/books/${bookId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get a single series by ID
   * @param {string} seriesId - Series ID
   * @returns {Promise<Object>}
   */
  async getSeriesById(seriesId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/series/${seriesId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Update read progress for a book
   * @param {string} bookId - Book ID
   * @param {number} page - Current page number
   * @param {boolean} completed - Whether the book is completed
   * @returns {Promise<Object>}
   */
  async updateProgress(bookId, page, completed) {
    const response = await this.#httpClient.patch(
      `${this.#host}/api/v1/books/${bookId}/read-progress`,
      { page, completed },
      {
        headers: {
          ...this.#getHeaders(),
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  }
}

export default KomgaClient;
