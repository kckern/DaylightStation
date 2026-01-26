/**
 * AudiobookshelfProxyAdapter - Proxy adapter for Audiobookshelf
 *
 * Implements IProxyAdapter for forwarding requests to Audiobookshelf
 * with Bearer token authentication.
 *
 * @module adapters/proxy
 */

import { configService } from '../../0_system/config/index.mjs';

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class AudiobookshelfProxyAdapter {
  #host;
  #token;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Audiobookshelf server URL (e.g., 'http://localhost:13378')
   * @param {string} config.token - Audiobookshelf API token
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#token = config.token;
    this.#logger = options.logger || console;
  }

  /**
   * Get service identifier
   * @returns {string}
   */
  getServiceName() {
    return 'audiobookshelf';
  }

  /**
   * Get Audiobookshelf server base URL
   * @returns {string}
   */
  getBaseUrl() {
    return this.#host;
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.#host && this.#token);
  }

  /**
   * Get authentication headers
   * Audiobookshelf uses Bearer token
   * @returns {Object}
   */
  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.#token}`
    };
  }

  /**
   * No auth params needed for Audiobookshelf
   * @returns {null}
   */
  getAuthParams() {
    return null;
  }

  /**
   * Transform incoming path
   * Strips /audiobookshelf prefix if present
   * @param {string} path
   * @returns {string}
   */
  transformPath(path) {
    return path.replace(/^\/audiobookshelf/, '');
  }

  /**
   * Default retry configuration
   * @returns {{ maxRetries: number, delayMs: number }}
   */
  getRetryConfig() {
    return {
      maxRetries: 3,
      delayMs: 500
    };
  }

  /**
   * Standard retry logic
   * @param {number} statusCode
   * @returns {boolean}
   */
  shouldRetry(statusCode) {
    return statusCode >= 500 || statusCode === 429;
  }

  /**
   * Longer timeout for audio streaming
   * @returns {number}
   */
  getTimeout() {
    return 60000;
  }
}

/**
 * Create an AudiobookshelfProxyAdapter from ConfigService
 * @param {Object} [options]
 * @returns {AudiobookshelfProxyAdapter}
 */
export function createAudiobookshelfProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('audiobookshelf') || {};
  const host = adapterConfig.host;
  const token = configService.getSecret('AUDIOBOOKSHELF_TOKEN');

  return new AudiobookshelfProxyAdapter({ host, token }, options);
}

export default AudiobookshelfProxyAdapter;
