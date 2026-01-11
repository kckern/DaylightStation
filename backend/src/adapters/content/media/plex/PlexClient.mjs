// backend/src/adapters/content/media/plex/PlexClient.mjs

/**
 * Low-level Plex API client for making authenticated requests to Plex Media Server.
 */
export class PlexClient {
  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., http://10.0.0.10:32400)
   * @param {string} [config.token] - Plex auth token
   */
  constructor(config) {
    if (!config.host) {
      throw new Error('PlexClient requires host');
    }
    this.host = config.host.replace(/\/$/, '');
    this.token = config.token || '';
  }

  /**
   * Make authenticated request to Plex API
   * @param {string} path - API endpoint path
   * @returns {Promise<Object>} JSON response
   */
  async request(path) {
    const url = `${this.host}${path}`;
    const headers = {
      'Accept': 'application/json',
      'X-Plex-Token': this.token
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Plex API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
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
}
