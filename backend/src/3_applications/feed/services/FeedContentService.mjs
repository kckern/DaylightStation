// backend/src/3_applications/feed/services/FeedContentService.mjs
/**
 * FeedContentService
 *
 * Application-layer orchestrator for feed content operations.
 * Delegates external fetching and parsing to the injected web content gateway.
 *
 * @module applications/feed/services/FeedContentService
 */

export class FeedContentService {
  #webContentGateway;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.webContentGateway - Adapter for fetching/parsing web content
   * @param {Object} [deps.logger]
   */
  constructor({ webContentGateway, logger = console }) {
    if (!webContentGateway) throw new Error('webContentGateway is required');
    this.#webContentGateway = webContentGateway;
    this.#logger = logger;
  }

  /**
   * Resolve a source icon for the given URL.
   * @param {string} url
   * @returns {Promise<{ data: Buffer, contentType: string } | null>}
   */
  async resolveIcon(url) {
    return this.#webContentGateway.resolveIcon(url);
  }

  /**
   * Proxy an image URL, returning an SVG placeholder on failure.
   * @param {string} url
   * @returns {Promise<{ data: Buffer, contentType: string }>}
   */
  async proxyImage(url) {
    return this.#webContentGateway.proxyImage(url);
  }

  /**
   * Extract readable content from a web page.
   * @param {string} url
   * @returns {Promise<{ title: string|null, content: string, wordCount: number, ogImage: string|null }>}
   */
  async extractReadableContent(url) {
    return this.#webContentGateway.extractReadableContent(url);
  }
}
