// backend/src/adapters/content/media/plex/PlexClient.mjs

/**
 * Low-level Plex API client for making authenticated requests to Plex Media Server.
 */
export class PlexClient {
  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., http://10.0.0.10:32400)
   * @param {string} [config.token] - Plex auth token
   * @param {string} [config.protocol] - Streaming protocol (default: 'dash')
   * @param {string} [config.platform] - Client platform (default: 'Chrome')
   */
  constructor(config) {
    if (!config.host) {
      throw new Error('PlexClient requires host');
    }
    this.host = config.host.replace(/\/$/, '');
    this.token = config.token || '';
    this.protocol = config.protocol || 'dash';
    this.platform = config.platform || 'Chrome';
  }

  /**
   * Make authenticated request to Plex API
   * @param {string} path - API endpoint path
   * @param {Object} [options] - Request options
   * @param {boolean} [options.includeToken] - Whether to append token as query param (default: false, uses header)
   * @returns {Promise<Object>} JSON response
   */
  async request(path, options = {}) {
    let url = `${this.host}${path}`;
    const headers = {
      'Accept': 'application/json',
      'X-Plex-Token': this.token
    };

    // Some endpoints need token as query param instead of header
    if (options.includeToken) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}X-Plex-Token=${this.token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Plex API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Make a raw request and return the full URL (for redirect/proxy scenarios)
   * @param {string} path - API endpoint path
   * @returns {string} Full URL with token
   */
  buildUrl(path) {
    const separator = path.includes('?') ? '&' : '?';
    return `${this.host}${path}${separator}X-Plex-Token=${this.token}`;
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
          title: item.title,
          year: item.year,
          type: item.type,
          guid: item.guid
        });
      }
    }

    return { results };
  }
}
