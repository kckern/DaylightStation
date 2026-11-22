/**
 * PlexLiveTvProxyAdapter - Proxy adapter for Plex's free live TV channels
 *
 * The channels on watch.plex.tv/live-tv (NFL Channel and ~700 others) are not
 * served by our Plex Media Server. They come from Plex's cloud at
 * `epg.provider.plex.tv`, authenticated with the same account token. This
 * adapter forwards the HLS playlist chain for one channel:
 *
 *   /library/parts/<id>.m3u8          master playlist  (epg.provider.plex.tv)
 *   /library/parts/<id>/variant.m3u8  variant playlist (epg.provider.plex.tv)
 *   segment .ts files                 third-party CDN, signed URLs
 *
 * Plex writes the account token in clear text into the variant URLs of the
 * master playlist. Every playlist is therefore rewritten before it leaves:
 * the token is removed from every URL, and URLs on the Plex host are pointed
 * back through this proxy (which adds the token upstream). Segment URLs keep
 * their CDN host — they are signed per request, carry no token and allow any
 * origin, so the video bytes go from the CDN to the screen directly.
 *
 * Only `/library/parts/...` is reachable through the proxy (playlists are
 * rewritten, anything else there streams through as-is); the rest of the
 * provider API (lineups, grid) is read server-side by the content source.
 *
 * @module adapters/proxy
 */

export const PLEX_LIVE_TV_HOST = 'https://epg.provider.plex.tv';

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class PlexLiveTvProxyAdapter {
  #host;
  #token;
  #publicPrefix;

  /**
   * @param {Object} config
   * @param {string} config.token - Plex account token
   * @param {string} [config.host] - Provider host (default epg.provider.plex.tv)
   * @param {string} [config.publicPrefix] - Where this proxy is mounted, as the browser sees it
   */
  constructor(config = {}) {
    this.#host = config.host || PLEX_LIVE_TV_HOST;
    this.#token = config.token || null;
    this.#publicPrefix = (config.publicPrefix || '/api/v1/proxy/plex-live').replace(/\/$/, '');
  }

  getServiceName() { return 'plex-live'; }
  getBaseUrl() { return this.#host; }
  isConfigured() { return Boolean(this.#token); }
  getAuthParams() { return { 'X-Plex-Token': this.#token }; }
  getAuthHeaders() { return null; }

  /** Channel media only (`/library/parts/...`) — never the account-wide provider API. */
  allowsPath(path) {
    return isPartPath(path);
  }

  /** A playlist is small and live: re-fetch every time, a few quick retries. */
  getRetryConfig() { return { maxRetries: 2, delayMs: 300 }; }
  getTimeout() { return 15000; }

  getResponseHeaders(path, statusCode) {
    if (!isPlaylistPath(path)) return null;
    return { 'cache-control': 'no-store' };
  }

  getBodyRewriter(path) {
    if (!isPlaylistPath(path)) return null;
    const base = new URL(String(path).split('?')[0], this.#host);
    return (text) => rewritePlaylist(text, { base, host: this.#host, publicPrefix: this.#publicPrefix });
  }
}

/** `/library/parts/<id>[/<file>]` with plain path segments (no `..`, no encoding tricks). */
function isPartPath(path) {
  const pathname = String(path || '').split('?')[0];
  return /^\/library\/parts\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?)*(?:\.m3u8)?$/.test(pathname);
}

function isPlaylistPath(path) {
  return isPartPath(path) && /\.m3u8$/.test(String(path).split('?')[0]);
}

const TOKEN_PARAM = /^x-plex-token$/i;

/**
 * Rewrite every URL in an HLS playlist: drop the token, and send URLs on the
 * provider host back through the proxy. URLs appear as their own lines and as
 * `URI="..."` attributes (keys, media renditions, maps).
 *
 * @param {string} text
 * @param {{ base: URL, host: string, publicPrefix: string }} ctx
 * @returns {string}
 */
export function rewritePlaylist(text, { base, host, publicPrefix }) {
  const providerOrigin = new URL(host).origin;
  const rewriteUrl = (raw) => {
    let url;
    try { url = new URL(raw, base); } catch { return raw; }
    for (const key of [...url.searchParams.keys()]) {
      if (TOKEN_PARAM.test(key)) url.searchParams.delete(key);
    }
    if (url.origin === providerOrigin) return `${publicPrefix}${url.pathname}${url.search}`;
    return url.href;
  };

  return String(text).split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]*)"/g, (_, uri) => `URI="${rewriteUrl(uri)}"`);
    }
    return rewriteUrl(trimmed);
  }).join('\n');
}

export default PlexLiveTvProxyAdapter;
