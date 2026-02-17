/**
 * RedditImageProxyAdapter - Proxy adapter for Reddit image CDNs
 *
 * Proxies requests to Reddit's image hosts (i.redd.it, preview.redd.it)
 * which block direct hotlinking from external referrers.
 *
 * URL scheme: /proxy/reddit/{host}/{path}
 *   e.g. /proxy/reddit/i.redd.it/abc123.jpg
 *     → https://i.redd.it/abc123.jpg
 *
 * @module adapters/proxy
 */

const ALLOWED_HOSTS = new Set([
  'i.redd.it',
  'preview.redd.it',
  'external-preview.redd.it',
  'img.youtube.com',
  'i.ytimg.com',
  'i.imgur.com',
]);

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class RedditImageProxyAdapter {
  #logger;

  constructor(options = {}) {
    this.#logger = options.logger || console;
  }

  getServiceName() { return 'reddit'; }

  // Fallback; transformPath returns absolute URLs so this is ignored
  getBaseUrl() { return 'https://i.redd.it'; }

  isConfigured() { return true; }

  getAuthHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (compatible; DaylightStation/1.0)',
      'Accept': 'image/*',
    };
  }

  getAuthParams() { return null; }

  /**
   * Reconstruct full external URL from the proxy path.
   * Input:  /i.redd.it/abc123.jpg?width=640
   * Output: https://i.redd.it/abc123.jpg?width=640
   */
  transformPath(path) {
    const fullUrl = 'https:/' + path;
    const parsed = new URL(fullUrl);
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      throw new Error(`Domain not allowed: ${parsed.hostname}`);
    }
    return fullUrl;
  }

  getRetryConfig() { return { maxRetries: 1, delayMs: 300 }; }

  shouldRetry(statusCode) { return statusCode >= 500; }

  getTimeout() { return 15000; }
}

export default RedditImageProxyAdapter;
