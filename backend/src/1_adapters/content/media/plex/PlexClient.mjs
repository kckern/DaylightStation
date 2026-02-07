// backend/src/adapters/content/media/plex/PlexClient.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Low-level Plex API client for making authenticated requests to Plex Media Server.
 */
export class PlexClient {
  #host;
  #token;
  #protocol;
  #platform;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., http://10.0.0.10:32400)
   * @param {string} [config.token] - Plex auth token
   * @param {string} [config.protocol='dash'] - Streaming protocol
   * @param {string} [config.platform='Chrome'] - Client platform
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('PlexClient requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('PlexClient requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }
    this.#host = config.host.replace(/\/$/, '');
    this.#token = config.token || '';
    this.#protocol = config.protocol || 'dash';
    this.#platform = config.platform || 'Chrome';
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  /**
   * Make authenticated request to Plex API
   * @param {string} path - API endpoint path
   * @param {Object} [options] - Request options
   * @param {boolean} [options.includeToken] - Whether to append token as query param (default: false, uses header)
   * @returns {Promise<Object>} JSON response
   */
  async request(path, options = {}) {
    let url = `${this.#host}${path}`;

    // Always include token as query param when available to support reverse proxies
    if (this.#token) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}X-Plex-Token=${this.#token}`;
    }

    try {
      const response = await this.#httpClient.get(url, {
        headers: {
          'Accept': 'application/json',
          ...(this.#token ? { 'X-Plex-Token': this.#token } : {})
        }
      });

      return response.data;
    } catch (error) {
      this.#logger.error?.('plex.request.failed', {
        path,
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Media API request failed');
      wrapped.code = error.code || 'MEDIA_API_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }

  /**
   * Make a raw request and return the full URL (for redirect/proxy scenarios)
   * @param {string} path - API endpoint path
   * @returns {string} Full URL with token
   */
  buildUrl(path) {
    const separator = path.includes('?') ? '&' : '?';
    return `${this.#host}${path}${separator}X-Plex-Token=${this.#token}`;
  }

  /**
   * Get all library sections
   * @returns {Promise<Object>}
   */
  async getLibrarySections() {
    return this.request('/library/sections');
  }

  /**
   * Get container contents by key
   * @param {string} key - Container path (e.g., /library/sections/1/all)
   * @returns {Promise<Object>}
   */
  async getContainer(key) {
    return this.request(key);
  }

  /**
   * Get metadata for a specific item by rating key
   * @param {string} ratingKey - Plex item rating key
   * @returns {Promise<Object>}
   */
  async getMetadata(ratingKey) {
    return this.request(`/library/metadata/${ratingKey}`);
  }

  /**
   * Search Plex hub for media items
   * Migrated from: mediaMemoryValidator.mjs:66-84
   * @param {string} query - Search query
   * @param {Object} [options] - Search options
   * @param {string} [options.libraryId] - Filter by library section ID
   * @param {number} [options.limit] - Max results per hub (default: 10)
   * @returns {Promise<{results: Array}>} Flattened search results
   */
  async hubSearch(query, options = {}) {
    const { libraryId, limit = 10 } = options;

    let path = `/hubs/search?query=${encodeURIComponent(query)}&limit=${limit}`;
    if (libraryId) {
      path += `&sectionId=${libraryId}`;
    }

    const response = await this.request(path);
    const container = response.MediaContainer || {};

    // Flatten results from all hubs
    const results = [];
    for (const hub of container.Hub || []) {
      for (const item of hub.Metadata || []) {
        results.push({
          ratingKey: item.ratingKey,
          id: item.ratingKey, // Legacy alias
          title: item.title,
          parent: item.parentTitle || null, // For TV episodes: season name
          grandparent: item.grandparentTitle || null, // For TV episodes: show name
          year: item.year,
          type: item.type,
          guid: item.guid
        });
      }
    }

    return { results };
  }
}

export default PlexClient;
