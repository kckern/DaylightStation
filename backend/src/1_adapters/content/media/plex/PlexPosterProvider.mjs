// backend/src/1_adapters/content/media/plex/PlexPosterProvider.mjs

/**
 * PlexPosterProvider — fetches poster artwork bytes for a content id from Plex.
 *
 * Extracted from the inline `posterProvider` closure in bootstrap (audit S-3).
 * Selects the best thumbnail for an item (prefers the show/grandparent poster),
 * builds an authenticated direct-Plex URL from the proxy-relative thumbnail
 * path, and downloads the image bytes.
 *
 * Behavior-preserving notes:
 * - Thumbnail lookup is duck-typed on an injected `getThumbnails(localId)`
 *   function (expected shape: `[thumb, parentThumb, grandparentThumb]`).
 *   When absent, the provider resolves to null — matching the original
 *   bootstrap guard (`if (!fitnessContentAdapter?.getThumbnails) return null`).
 *   NOTE: PlexAdapter currently exposes this capability as `loadImgFromKey`,
 *   not `getThumbnails`, so with today's wiring the guard short-circuits and
 *   no poster is fetched — a pre-existing (latent) mismatch preserved here
 *   for behavior parity. Fixing it is a one-line wiring change at the
 *   composition root once intended.
 * - Every failure path resolves to null (never throws); errors are logged
 *   under the original `fitness.timelapse.poster_provider_failed` event.
 */
export class PlexPosterProvider {
  #host;
  #token;
  #proxyPath;
  #getThumbnails;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} [config.host] - Plex server base URL (no trailing slash)
   * @param {string} [config.token] - X-Plex-Token
   * @param {string} [config.proxyPath] - Proxy prefix thumbnails are served under (stripped to rebuild the direct URL)
   * @param {?(localId: string) => Promise<string[]>} [config.getThumbnails] - Bound thumbnail lookup ([thumb, parentThumb, grandparentThumb])
   * @param {Object} config.httpClient - System HttpClient (uses requestRaw for binary download)
   * @param {Object} [config.logger]
   */
  constructor({ host, token, proxyPath, getThumbnails, httpClient, logger = console } = {}) {
    this.#host = host || '';
    this.#token = token || '';
    this.#proxyPath = proxyPath || '';
    this.#getThumbnails = typeof getThumbnails === 'function' ? getThumbnails : null;
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  /**
   * Fetch poster image bytes for a content id.
   * @param {string} contentId - Compound id (e.g. `plex:12345`) or bare local id
   * @returns {Promise<Buffer|null>} Image bytes, or null when unavailable
   */
  async getPoster(contentId) {
    try {
      if (!this.#getThumbnails) return null;
      const localId = String(contentId).replace(/^[a-z]+:/i, '');
      const thumbs = await this.#getThumbnails(localId); // [thumb, parentThumb, grandparentThumb]
      const chosen = thumbs?.[2] || thumbs?.[0]; // prefer the show (grandparent) poster
      if (!chosen) return null;
      const rawPath = chosen.replace(this.#proxyPath, '');
      const sep = rawPath.includes('?') ? '&' : '?';
      const url = `${this.#host}${rawPath}${sep}X-Plex-Token=${this.#token}`;
      const resp = await this.#httpClient.requestRaw('GET', url, { responseType: 'buffer' });
      if (!resp.ok) return null;
      return resp.data;
    } catch (err) {
      this.#logger.warn?.('fitness.timelapse.poster_provider_failed', { contentId, error: err.message });
      return null;
    }
  }
}
