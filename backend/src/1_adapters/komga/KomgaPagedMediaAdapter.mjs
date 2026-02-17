// backend/src/1_adapters/komga/KomgaPagedMediaAdapter.mjs

import { IPagedMediaGateway } from '#apps/agents/paged-media-toc/ports/IPagedMediaGateway.mjs';

/**
 * KomgaPagedMediaAdapter — Komga implementation of IPagedMediaGateway.
 *
 * Composes KomgaClient for JSON API calls. Handles image fetching
 * with retry logic directly (KomgaClient's httpClient is JSON-oriented).
 *
 * @module adapters/komga/KomgaPagedMediaAdapter
 */
export class KomgaPagedMediaAdapter extends IPagedMediaGateway {
  #client;
  #host;
  #apiKey;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('../content/readable/komga/KomgaClient.mjs').KomgaClient} deps.client - KomgaClient instance
   * @param {string} deps.apiKey - Komga API key (for image fetch headers)
   * @param {Object} [deps.logger]
   */
  constructor({ client, apiKey, logger = console }) {
    super();
    if (!client) throw new Error('KomgaPagedMediaAdapter requires client');
    if (!apiKey) throw new Error('KomgaPagedMediaAdapter requires apiKey');
    this.#client = client;
    this.#host = client.host;
    this.#apiKey = apiKey;
    this.#logger = logger;
  }

  async getRecentBooks(seriesId, limit) {
    const data = await this.#client.getBooks(seriesId, {
      size: limit,
      sort: 'metadata.numberSort,desc',
    });
    return (data?.content || []).map(book => ({
      id: book.id,
      title: book.metadata?.title || book.name || 'Unknown',
      pageCount: book.media?.pagesCount || 0,
    }));
  }

  async getPageThumbnail(bookId, page) {
    const url = `${this.#host}/api/v1/books/${bookId}/pages/${page}/thumbnail`;
    return this.#fetchImage(url, 15000);
  }

  async getPageImage(bookId, page) {
    const url = `${this.#host}/api/v1/books/${bookId}/pages/${page}`;
    return this.#fetchImage(url, 30000);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  async #fetchImage(url, timeoutMs) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'X-API-Key': this.#apiKey, 'Accept': 'image/jpeg' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        return {
          imageDataUri: `data:${contentType};base64,${buffer.toString('base64')}`,
          sizeBytes: buffer.length,
        };
      } catch (err) {
        if (attempt < maxRetries && /SSL|ECONNRESET|socket|ETIMEDOUT/i.test(err.message)) {
          const delay = attempt * 2000;
          this.#logger.warn?.('paged-media.fetch.retry', { url, attempt, delay, error: err.message });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Max retries exceeded');
  }
}
