/**
 * PlexProxyAdapter - Proxy adapter for Plex Media Server
 *
 * Implements IProxyAdapter for forwarding requests to Plex
 * with token-based authentication.
 *
 * Includes test infrastructure for simulating network stalls.
 *
 * @module adapters/proxy
 */

import { configService } from '#system/config/index.mjs';

// ═══════════════════════════════════════════════════════════════
// Test Infrastructure: Shutoff Valve
// ═══════════════════════════════════════════════════════════════

/**
 * Global shutoff valve state for testing
 * When enabled, proxy requests will be delayed or blocked
 */
const shutoffValve = {
  enabled: false,
  mode: 'block',  // 'block' | 'delay'
  delayMs: 30000, // Delay duration for 'delay' mode
  blockedRequests: 0,
  delayedRequests: 0
};

/**
 * Enable the Plex proxy shutoff valve (for testing network stalls)
 * @param {Object} options
 * @param {'block'|'delay'} [options.mode='block'] - Block requests entirely or delay them
 * @param {number} [options.delayMs=30000] - Delay duration in ms (for delay mode)
 */
export function enablePlexShutoff(options = {}) {
  shutoffValve.enabled = true;
  shutoffValve.mode = options.mode || 'block';
  shutoffValve.delayMs = options.delayMs || 30000;
  shutoffValve.blockedRequests = 0;
  shutoffValve.delayedRequests = 0;
}

/**
 * Disable the Plex proxy shutoff valve
 */
export function disablePlexShutoff() {
  shutoffValve.enabled = false;
}

/**
 * Get shutoff valve status
 * @returns {{ enabled: boolean, mode: string, delayMs: number, blockedRequests: number, delayedRequests: number }}
 */
export function getPlexShutoffStatus() {
  return { ...shutoffValve };
}

/**
 * Check if request should be blocked/delayed
 * @returns {Promise<void>} - Resolves immediately if not blocked, delays or rejects if shutoff enabled
 */
export async function checkShutoffValve() {
  if (!shutoffValve.enabled) return;

  if (shutoffValve.mode === 'block') {
    shutoffValve.blockedRequests++;
    throw new Error('PLEX_SHUTOFF: Request blocked by test shutoff valve');
  }

  if (shutoffValve.mode === 'delay') {
    shutoffValve.delayedRequests++;
    await new Promise(resolve => setTimeout(resolve, shutoffValve.delayMs));
  }
}

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class PlexProxyAdapter {
  #host;
  #token;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., 'http://localhost:32400')
   * @param {string} config.token - Plex authentication token
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
    return 'plex';
  }

  /**
   * Get Plex server base URL
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
   * Get authentication query parameters
   * Plex uses X-Plex-Token as a query parameter
   * @returns {Object}
   */
  getAuthParams() {
    return {
      'X-Plex-Token': this.#token
    };
  }

  /**
   * No auth headers needed for Plex (uses query params)
   * @returns {null}
   */
  getAuthHeaders() {
    return null;
  }

  /**
   * Transform incoming path
   * Strips /plex_proxy prefix if present (for backward compatibility with legacy paths)
   * New canonical path is /api/v1/proxy/plex/* which doesn't need transformation
   * @param {string} path
   * @returns {string}
   */
  transformPath(path) {
    return path.replace(/^\/plex_proxy/, '');
  }

  /**
   * Plex-specific retry configuration
   * More aggressive than default for media server
   * @returns {{ maxRetries: number, delayMs: number }}
   */
  getRetryConfig() {
    return {
      maxRetries: 20,
      delayMs: 500
    };
  }

  /**
   * Retry only on transient errors
   * Don't retry permanent failures like 403 (auth) or 404 (not found)
   * @param {number} statusCode
   * @param {number} attempt
   * @returns {boolean}
   */
  shouldRetry(statusCode, attempt) {
    // Retry on rate limiting
    if (statusCode === 429) return true;
    
    // Retry on server errors (5xx) - these are typically transient
    if (statusCode >= 500 && statusCode < 600) return true;
    
    // Don't retry client errors (4xx) - these are permanent
    // 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, etc.
    return false;
  }

  /**
   * Longer timeout for media operations
   * @returns {number}
   */
  getTimeout() {
    return 60000; // 60 seconds
  }
}

/**
 * Create a PlexProxyAdapter from ConfigService
 * @param {Object} [options]
 * @param {Object} [options.logger] - Logger instance
 * @returns {PlexProxyAdapter}
 */
export function createPlexProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('plex') || {};
  const host = adapterConfig.host;
  const token = configService.getSecret('PLEX_TOKEN');

  return new PlexProxyAdapter({ host, token }, options);
}

export default PlexProxyAdapter;
