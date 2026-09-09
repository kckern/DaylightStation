// backend/src/1_adapters/books/CoverArtAdapter.mjs

import { HttpClient } from '#system/services/HttpClient.mjs';
import { judgeCoverImage } from '#domains/books/BookCoverArt.mjs';

/**
 * CoverArtAdapter — the network half of finding a book's cover.
 *
 * Two jobs, both deliberately dumb: FETCH one candidate URL and say what came
 * back, and SEARCH for image URLs when the catalogues have run out. The ladder,
 * the ordering and the verdict all live elsewhere — `2_domains/books/BookCoverArt`
 * judges the bytes, `3_applications/books/ResolveBookCover` walks the list.
 *
 * ## A FETCH NEVER THROWS
 *
 * A cover is decoration on a record that already resolved. Every failure —
 * timeout, DNS, 404, a login page served as 200 — comes back as
 * `{usable: false, reason}` so the caller simply moves to the next rung. The
 * one thing it must never do is take down the book lookup that summoned it.
 *
 * ## EVERY FETCH IS BOUNDED AND CAPPED
 *
 * `timeoutMs` (default 6000) rides each request, and anything past `maxBytes`
 * (default 6MB) is rejected rather than buffered: this walks up to six URLs
 * from providers the household does not control, on a request a child is
 * waiting on.
 *
 * ## THE SEARCH IS THE LAST RUNG, AND IT IS OPTIONAL
 *
 * Google Programmable Search (`searchType=image`) is the only rung that needs a
 * key — `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` in `household/auth/google.yml`,
 * whose own comment has said "for image search fallback" since the file was
 * written. Unkeyed, `searchImages` answers an empty list and the ladder simply
 * ends one rung earlier.
 *
 * @module adapters/books/CoverArtAdapter
 */

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_BYTES = 6 * 1024 * 1024;
const SEARCH_URL = 'https://www.googleapis.com/customsearch/v1';

/**
 * Providers hand a browser-shaped request a cover and a bot-shaped one a 403.
 * Amazon's image host is the measured case; a plain UA costs nothing elsewhere.
 */
const FETCH_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (compatible; DaylightStation/1.0; household reading log)',
  Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
});

export class CoverArtAdapter {
  #httpClient; #logger; #timeoutMs; #maxBytes; #apiKey; #cseId; #searchUrl;

  /**
   * @param {object} deps
   * @param {string} [deps.apiKey] - Google API key for the image-search rung
   * @param {string} [deps.cseId] - Programmable Search engine id
   */
  constructor({
    httpClient, logger = console, timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES, apiKey = null, cseId = null, searchUrl = SEARCH_URL,
  } = {}) {
    this.#httpClient = httpClient || new HttpClient({ logger });
    this.#logger = logger;
    this.#timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    this.#maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
    this.#apiKey = apiKey || null;
    this.#cseId = cseId || null;
    this.#searchUrl = searchUrl;
  }

  get id() { return 'coverart'; }

  /** True when the image-search rung is available at all. */
  get canSearch() { return Boolean(this.#apiKey && this.#cseId); }

  /**
   * Fetch one candidate and judge it.
   *
   * @param {string} url
   * @returns {Promise<{usable: boolean, reason: string|null, status: number|null,
   *   contentType: string|null, bytes: Buffer|null, width: number|null,
   *   height: number|null, format: string|null, byteLength: number}>}
   */
  async fetch(url) {
    const miss = (reason, extra = {}) => ({
      usable: false, reason, status: null, contentType: null, bytes: null,
      width: null, height: null, format: null, byteLength: 0, ...extra,
    });
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return miss('not-https');

    let res;
    try {
      res = await this.#httpClient.requestRaw('GET', url, {
        headers: FETCH_HEADERS, responseType: 'buffer', timeout: this.#timeoutMs,
      });
    } catch (error) {
      this.#logger.debug?.('books.cover.fetch-failed', { url, error: error.message });
      return miss('unreachable');
    }

    if (!res.ok) return miss(`http-${res.status}`, { status: res.status });
    const bytes = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data ?? []);
    if (bytes.length > this.#maxBytes) return miss('too-large', { status: res.status, byteLength: bytes.length });

    const contentType = res.headers?.['content-type'] ?? null;
    const verdict = judgeCoverImage({ contentType, bytes });
    return { ...verdict, status: res.status, contentType, bytes: verdict.usable ? bytes : null };
  }

  /**
   * Image URLs for a query, best first. Never throws and never returns null.
   *
   * @param {string} query
   * @param {{limit?: number}} [options]
   * @returns {Promise<string[]>}
   */
  async searchImages(query, { limit = 5 } = {}) {
    if (!this.canSearch || typeof query !== 'string' || !query.trim()) return [];
    const params = new URLSearchParams({
      key: this.#apiKey, cx: this.#cseId, q: query.trim(), searchType: 'image',
      num: String(Math.min(10, Math.max(1, limit))), safe: 'active', imgSize: 'large',
    });
    try {
      const res = await this.#httpClient.requestRaw('GET', `${this.#searchUrl}?${params}`, {
        responseType: 'json', timeout: this.#timeoutMs,
      });
      if (!res.ok) {
        this.#logger.warn?.('books.cover.search-failed', { status: res.status });
        return [];
      }
      return (res.data?.items ?? []).map((item) => item?.link).filter((link) => typeof link === 'string' && /^https:\/\//i.test(link));
    } catch (error) {
      this.#logger.warn?.('books.cover.search-failed', { error: error.message });
      return [];
    }
  }
}

export default CoverArtAdapter;
