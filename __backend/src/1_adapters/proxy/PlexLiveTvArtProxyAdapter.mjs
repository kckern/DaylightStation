/**
 * PlexLiveTvArtProxyAdapter - channel art for Plex free live TV
 *
 * A live channel's logo, poster and background live on
 * `provider-static.plex.tv` (public, no token), not on the playlist host the
 * `plex-live` proxy forwards to. Menus and the display router expect art at
 * an app path, so channel art is served from `/api/v1/proxy/plex-live-art/*`
 * and cached hard (the CMS paths are content-addressed).
 *
 * Only `/epg/cms/...` image files are reachable.
 *
 * @module adapters/proxy
 */

export const PLEX_LIVE_TV_ART_HOST = 'https://provider-static.plex.tv';

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class PlexLiveTvArtProxyAdapter {
  #host;

  constructor(config = {}) {
    this.#host = config.host || PLEX_LIVE_TV_ART_HOST;
  }

  getServiceName() { return 'plex-live-art'; }
  getBaseUrl() { return this.#host; }
  isConfigured() { return true; }

  allowsPath(path) {
    const pathname = String(path || '').split('?')[0];
    return /^\/epg\/cms\/[A-Za-z0-9/_.()+-]+\.(?:png|jpe?g|webp|svg)$/i.test(pathname) && !pathname.includes('..');
  }

  getRetryConfig() { return { maxRetries: 1, delayMs: 300 }; }
  getTimeout() { return 15000; }

  /** Any upstream failure becomes the placeholder image, not a JSON error. */
  getErrorFallback() { return 'svg'; }

  getResponseHeaders(path, statusCode) {
    if (statusCode >= 200 && statusCode < 300) {
      return { 'cache-control': 'public, max-age=31536000, immutable' };
    }
    return null;
  }
}

export default PlexLiveTvArtProxyAdapter;
