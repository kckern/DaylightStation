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

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class PlexProxyAdapter {
  #host;
  #token;
  #logger;

  // ═══════════════════════════════════════════════════════════════
  // Test Infrastructure: Shutoff Valve (per-instance state)
  // When enabled, proxy requests will be delayed or blocked.
  // ═══════════════════════════════════════════════════════════════
  #shutoff;

  /**
   * @param {Object} config
   * @param {string} config.host - Plex server URL (e.g., 'http://localhost:32400')
   * @param {string} config.token - Plex authentication token
   * @param {Object} [config.shutoff] - Initial shutoff valve state (test injection)
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#token = config.token;
    this.#logger = options.logger || console;
    this.#shutoff = {
      enabled: false,
      mode: 'block',  // 'block' | 'delay'
      delayMs: 30000, // Delay duration for 'delay' mode
      blockedRequests: 0,
      delayedRequests: 0,
      ...(config.shutoff || {})
    };
  }

  /**
   * Enable the Plex proxy shutoff valve (for testing network stalls)
   * @param {Object} options
   * @param {'block'|'delay'} [options.mode='block'] - Block requests entirely or delay them
   * @param {number} [options.delayMs=30000] - Delay duration in ms (for delay mode)
   */
  enableShutoff(options = {}) {
    this.#shutoff.enabled = true;
    this.#shutoff.mode = options.mode || 'block';
    this.#shutoff.delayMs = options.delayMs || 30000;
    this.#shutoff.blockedRequests = 0;
    this.#shutoff.delayedRequests = 0;
  }

  /**
   * Disable the Plex proxy shutoff valve
   */
  disableShutoff() {
    this.#shutoff.enabled = false;
  }

  /**
   * Get shutoff valve status
   * @returns {{ enabled: boolean, mode: string, delayMs: number, blockedRequests: number, delayedRequests: number }}
   */
  getShutoffStatus() {
    return { ...this.#shutoff };
  }

  /**
   * Check if request should be blocked/delayed
   * @returns {Promise<void>} - Resolves immediately if not blocked, delays or rejects if shutoff enabled
   */
  async checkShutoffValve() {
    if (!this.#shutoff.enabled) return;

    if (this.#shutoff.mode === 'block') {
      this.#shutoff.blockedRequests++;
      throw new Error('PLEX_SHUTOFF: Request blocked by test shutoff valve');
    }

    if (this.#shutoff.mode === 'delay') {
      this.#shutoff.delayedRequests++;
      await new Promise(resolve => setTimeout(resolve, this.#shutoff.delayMs));
    }
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
  shouldRetry(statusCode, attempt, path = '') {
    // Retry on rate limiting
    if (statusCode === 429) return true;

    // A media file Plex cannot open answers 404 — but on 2026-09-28 that was
    // the NAS transiently zeroing modes, not a missing file, and the refusals
    // came and went. A short retry (3 × the 500ms delay) rides out the briefest
    // ones before the player ever sees an error.
    if (statusCode === 404 && isRefusableMediaPath(path)) return attempt < MEDIA_PART_404_RETRIES;
    
    // Retry on server errors (5xx) - these are typically transient
    if (statusCode >= 500 && statusCode < 600) return true;
    
    // Don't retry client errors (4xx) - these are permanent
    // 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, etc.
    return false;
  }

  /**
   * Inject caching headers for thumbnail responses.
   * Plex thumb URLs include a timestamp that changes when the image updates,
   * so they are safe to cache aggressively.
   * @param {string} path - Request path
   * @param {number} statusCode - Upstream status code
   * @returns {Object|null} Headers to merge into the response
   */
  getResponseHeaders(path, statusCode) {
    if (statusCode >= 200 && statusCode < 300 && /\/thumb\//.test(path)) {
      return { 'cache-control': 'public, max-age=31536000, immutable' };
    }
    return null;
  }

  /**
   * Where a missing playlist poster actually lives.
   *
   * Plex gives a playlist two art fields — `thumb` (a custom uploaded poster)
   * and `composite` (the auto-generated 2x2 mosaic) — stamped with the same
   * key. Content URLs prefer `thumb` so custom art is reachable at all, but a
   * few playlists advertise a thumb whose image file is gone upstream. Deriving
   * the composite from the 404 recovers those without a metadata round-trip per
   * request, and without having to know up front which playlists have real art.
   *
   * Only digits are carried across, so nothing from the request shapes the
   * fallback path beyond a rating key and a version key.
   *
   * @param {string} path - Upstream path that was requested
   * @param {number} statusCode - Upstream status code
   * @returns {string|null} Path to try instead, or null for none
   */
  getFallbackPath(path, statusCode) {
    if (statusCode !== 404) return null;
    const pathname = String(path || '').split('?')[0];
    const match = /\/library\/metadata\/(\d+)\/thumb\/(\d+)$/.exec(pathname);
    return match ? `/playlists/${match[1]}/composite/${match[2]}` : null;
  }

  /**
   * A media file that still 404s after the retries answers 503 instead.
   *
   * Plex says 404 both for "no such part" and for "the part exists but I could
   * not open it" (`Permission denied (13)` in its log). The second is what the
   * NAS produces when it zeroes a file's mode, and it is temporary. 503 tells
   * the Player to ask /api/v1/media-source/check and wait rather than treat the
   * file as gone; that check is also what tells a genuinely missing file apart.
   * Every other 404 passes through untouched.
   *
   * @param {string} path - Upstream path that was requested
   * @param {number} statusCode - Upstream status code
   * @returns {{status: number, headers?: Object, body: Object}|null}
   */
  getErrorReplacement(path, statusCode) {
    if (statusCode !== 404 || !isRefusableMediaPath(path)) return null;
    return {
      status: 503,
      headers: { 'retry-after': '5', 'cache-control': 'no-store' },
      body: { error: 'Media file temporarily unreadable', reason: 'source-unreadable' },
    };
  }

  /**
   * Longer timeout for media operations
   * @returns {number}
   */
  getTimeout() {
    return 60000; // 60 seconds
  }
}

const MEDIA_PART_404_RETRIES = 3;

/** `/library/parts/{id}/{ts}/file.{ext}` — a direct-play media file, with or without the proxy prefix. */
function isMediaPartFile(path) {
  const pathname = String(path || '').split('?')[0];
  return /\/library\/parts\/\d+\/\d+\/file\.[A-Za-z0-9]+$/.test(pathname);
}

/**
 * A transcode SEGMENT of a started session. An HLS/DASH refusal is invisible at
 * the manifest (it answers 200): the transcoder fails opening its input and the
 * segments 404 afterwards (2026-10-07). Only segment FILES
 * (`session/<id>/<variant>/<n>.ts|.m4s|header`) — never playlists
 * (`index.m3u8`, `start.m3u8`) or `decision`, whose 404 means something else.
 */
function isTranscodeSegment(path) {
  const pathname = String(path || '').split('?')[0];
  return /\/video\/:\/transcode\/universal\/session\/[^/]+\/[^/]+\/(?:[^/]+\.(?:ts|m4s)|header)$/.test(pathname);
}

/** A direct-play part or a transcode segment: what a refused source looks like at the proxy. */
function isRefusableMediaPath(path) {
  return isMediaPartFile(path) || isTranscodeSegment(path);
}

export default PlexProxyAdapter;
