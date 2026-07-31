// backend/src/1_adapters/reference/WikipediaAdapter.mjs

import { HttpClient } from '#system/services/HttpClient.mjs';

/**
 * WikipediaAdapter — client for the self-hosted Wikipedia service
 * (FastAPI wrapper around kiwix-serve, ZIM-backed, plain-text output).
 *
 * Endpoints mapped 1:1: /search, /article/{title}, /random, /health.
 * Base URL comes from services.yml via configService.resolveServiceUrl('wikipedia').
 *
 * @module adapters/reference/WikipediaAdapter
 */
export class WikipediaAdapter {
  #baseUrl;
  #httpClient;
  #logger;

  /**
   * @param {Object} deps
   * @param {string} deps.baseUrl - e.g. http://wikipedia:8098
   * @param {Object} [deps.logger]
   * @param {import('#system/services/HttpClient.mjs').HttpClient} [deps.httpClient]
   */
  constructor({ baseUrl, logger = console, httpClient } = {}) {
    if (!baseUrl) throw new Error('WikipediaAdapter requires baseUrl');
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#logger = logger;
    this.#httpClient = httpClient || new HttpClient({ logger });
  }

  get baseUrl() {
    return this.#baseUrl;
  }

  /**
   * Full-text search.
   * @param {string} query
   * @param {Object} [options]
   * @param {number} [options.limit=10]
   * @returns {Promise<Array<{title: string, snippet: string, path: string}>>}
   */
  async search(query, { limit = 10 } = {}) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await this.#get(`/search?${params}`);
    return res.data;
  }

  /**
   * Fetch an article as plain text. The service handles fuzzy title fallback.
   * @param {string} title
   * @returns {Promise<{title: string, text: string}|null>} null if not found
   */
  async getArticle(title) {
    const res = await this.#get(`/article/${encodeURIComponent(title)}`, { allow404: true });
    if (res.status === 404) return null;
    return res.data;
  }

  /**
   * Fetch a random article as plain text.
   * @returns {Promise<{title: string, text: string}>}
   */
  async random() {
    const res = await this.#get('/random');
    return res.data;
  }

  /**
   * Service health (kiwix reachability + book id).
   * @returns {Promise<{status: string, book_id: string}>}
   */
  async health() {
    const res = await this.#get('/health');
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  async #get(path, { allow404 = false } = {}) {
    const url = `${this.#baseUrl}${path}`;
    let res;
    try {
      res = await this.#httpClient.requestRaw('GET', url, { timeout: 15000 });
    } catch (err) {
      if (err?.status) throw err;
      throw new Error(`wikipedia service unreachable at ${this.#baseUrl}: ${err.message}`);
    }
    if (!res.ok && !(allow404 && res.status === 404)) {
      const detail = res.data?.detail || '';
      throw new Error(`wikipedia service error ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return res;
  }
}
