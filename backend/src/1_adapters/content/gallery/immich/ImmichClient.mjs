// backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Low-level Immich API client for making authenticated requests.
 */
export class ImmichClient {
  #host;
  #apiKey;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Immich server URL (e.g., http://localhost:2283)
   * @param {string} config.apiKey - Immich API key
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('ImmichClient requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('ImmichClient requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('ImmichClient requires httpClient', {
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
   * Get default headers for Immich API
   * @returns {Object}
   */
  #getHeaders() {
    return {
      'x-api-key': this.#apiKey,
      'Accept': 'application/json'
    };
  }

  /**
   * Get a single asset by ID
   * @param {string} id - Asset UUID
   * @returns {Promise<Object>}
   */
  async getAsset(id) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/assets/${id}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get all albums
   * @returns {Promise<Array>}
   */
  async getAlbums() {
    const response = await this.#httpClient.get(
      `${this.#host}/api/albums`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get album with assets
   * @param {string} albumId - Album UUID
   * @returns {Promise<Object>}
   */
  async getAlbum(albumId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/albums/${albumId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Search assets using metadata filters
   * @param {Object} query - Search parameters
   * @returns {Promise<{items: Array, total: number}>}
   */
  async searchMetadata(query) {
    const response = await this.#httpClient.post(
      `${this.#host}/api/search/metadata`,
      query,
      {
        headers: {
          ...this.#getHeaders(),
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.assets || { items: [], total: 0 };
  }

  /**
   * Get people (face recognition) with optional statistics enrichment
   * @param {Object} [options]
   * @param {boolean} [options.withStatistics] - Fetch asset counts for each person
   * @returns {Promise<Array>}
   */
  async getPeople(options = {}) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/people`,
      { headers: this.#getHeaders() }
    );
    // API returns { people: [...] } or array directly
    const people = response.data?.people || response.data || [];

    // Optionally enrich with statistics (asset counts)
    if (options.withStatistics) {
      // Only fetch stats for named people (unnamed are less useful)
      const namedPeople = people.filter(p => p.name && p.name.trim());
      await Promise.all(
        namedPeople.map(async (person) => {
          try {
            const stats = await this.getPersonStatistics(person.id);
            person.assetCount = stats.assets || 0;
          } catch (e) {
            person.assetCount = 0;
          }
        })
      );
    }

    return people;
  }

  /**
   * Get statistics for a person (asset count)
   * @param {string} personId
   * @returns {Promise<{assets: number}>}
   */
  async getPersonStatistics(personId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/people/${personId}/statistics`,
      { headers: this.#getHeaders() }
    );
    return response.data || { assets: 0 };
  }

  /**
   * Get assets for a specific person using search metadata API
   * @param {string} personId - Person ID
   * @param {number} [take=100] - Max number of assets to fetch
   * @returns {Promise<Array>}
   */
  async getPersonAssets(personId, take = 100) {
    // Use search metadata with personIds filter - the recommended approach
    const response = await this.#httpClient.post(
      `${this.#host}/api/search/metadata`,
      {
        personIds: [personId],
        take,
        order: 'desc'
      },
      { headers: this.#getHeaders() }
    );
    // Response has { assets: { items: [...], total: n } }
    return response.data?.assets?.items || response.data?.assets || [];
  }

  /**
   * Get timeline buckets
   * @param {string} [size='MONTH'] - Bucket size (DAY, MONTH)
   * @returns {Promise<Array>}
   */
  async getTimelineBuckets(size = 'MONTH') {
    const response = await this.#httpClient.get(
      `${this.#host}/api/timeline/buckets?size=${size}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Parse Immich duration string to seconds
   * @param {string} durationStr - "HH:MM:SS.mmm" format
   * @returns {number|null}
   */
  parseDuration(durationStr) {
    if (!durationStr || durationStr === '0:00:00.00000') return null;
    const parts = durationStr.split(':');
    if (parts.length !== 3) return null;
    const [h, m, rest] = parts;
    const [s] = rest.split('.');
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10);
  }
}

export default ImmichClient;
