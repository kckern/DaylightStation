import { coverCandidates, coverSearchQuery } from '#domains/books/BookCoverArt.mjs';

/**
 * ResolveBookCover — walk the ladder until a real cover falls out, then keep it.
 *
 * ## WHY THIS IS NOT PART OF `ResolveBook`
 *
 * Book FACTS and book ART fail differently. A child who typed a real ISBN
 * deserves the title even when every cover host is down, and a book whose art
 * only turned up on the fourth rung must not re-walk the first three on every
 * render. So the two have separate lifecycles: facts refresh on a thirty-day
 * clock through the metadata gateways, art is found once, stored as BYTES by
 * `BookCoverStore`, and re-asked only when nobody had any.
 *
 * ## THE LADDER
 *
 * `coverCandidates` builds the catalogue rungs (OpenLibrary by cover id, by
 * ISBN, by edition key; Amazon by ISBN-10; whatever the record already held;
 * Google Books by volume id) ordered so the BEST art wins rather than the
 * FIRST — see that module for the measurements. This adds the last rung: when
 * every catalogue has missed, a Google image search for the title.
 *
 * Each rung is fetched and JUDGED. Providers answer 200 for books they have no
 * art for, so "it downloaded" is not "it is a cover"; the domain's
 * `judgeCoverImage` is what separates a cover from Amazon's 43-byte dot and
 * Google's 1,269-byte grey rectangle.
 *
 * ## ONE WALK AT A TIME, PER BOOK
 *
 * Four tiles of the same book render four times at once on a freshly opened
 * shelf. In-flight walks are shared, so that is one ladder, not four.
 *
 * Layer: APPLICATION (3_applications/books).
 *
 * @module applications/books/ResolveBookCover
 */

/** How long a book with no art anywhere is left alone before asking again. */
const DEFAULT_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
/** How many image-search results are worth fetching before giving up. */
const DEFAULT_SEARCH_LIMIT = 4;

export class ResolveBookCover {
  #coverArt; #store; #repository; #logger; #clock; #retryMs; #searchLimit;
  #walking = new Map();

  /**
   * @param {object} deps
   * @param {object} deps.coverArt - CoverArtAdapter
   * @param {object} deps.store - BookCoverStore
   * @param {object} [deps.repository] - IBookRepository, for looking a record up by ISBN
   */
  constructor({
    coverArt, store, repository = null, logger = console,
    clock = () => new Date(), retryMs = DEFAULT_RETRY_MS, searchLimit = DEFAULT_SEARCH_LIMIT,
  } = {}) {
    if (!coverArt) throw new Error('ResolveBookCover requires coverArt');
    if (!store) throw new Error('ResolveBookCover requires store');
    this.#coverArt = coverArt;
    this.#store = store;
    this.#repository = repository;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
    this.#retryMs = Number.isFinite(retryMs) && retryMs >= 0 ? retryMs : DEFAULT_RETRY_MS;
    this.#searchLimit = Number.isFinite(searchLimit) && searchLimit > 0 ? searchLimit : DEFAULT_SEARCH_LIMIT;
  }

  /**
   * The stored art for a book, finding it first if this is the first ask.
   *
   * @param {string} isbn13
   * @param {{record?: object, refresh?: boolean}} [options] - pass `record` to
   *   save a repository read; `refresh` re-walks even a settled miss.
   * @returns {Promise<{bytes: Buffer, contentType: string, source: string|null}|null>}
   */
  async cover(isbn13, { record = null, refresh = false } = {}) {
    if (!refresh) {
      const stored = this.#store.read(isbn13);
      if (stored) return stored;
      if (this.#settledMiss(isbn13)) return null;
    }
    await this.execute(isbn13, { record, refresh });
    return this.#store.read(isbn13);
  }

  /**
   * Walk the ladder for one book. Idempotent, and shared between concurrent
   * callers asking about the same ISBN.
   *
   * @returns {Promise<{status: 'found'|'none'|'settled', source?: string, url?: string,
   *   attempts?: number, tried?: string[]}>}
   */
  async execute(isbn13, { record = null, refresh = false } = {}) {
    if (!/^\d{13}$/.test(String(isbn13 ?? ''))) return { status: 'none', attempts: 0 };
    if (!refresh && this.#store.has(isbn13)) {
      const meta = this.#store.readMeta(isbn13);
      return { status: 'found', source: meta?.source ?? null, url: meta?.url ?? null, attempts: 0 };
    }
    if (!refresh && this.#settledMiss(isbn13)) return { status: 'settled', attempts: 0 };

    const inFlight = this.#walking.get(isbn13);
    if (inFlight) return inFlight;

    const walk = this.#walk(isbn13, record)
      .catch((error) => {
        // Art is decoration. A thrown ladder must never reach the caller that
        // was only rendering a tile.
        this.#logger.warn?.('books.cover.walk-failed', { isbn13, error: error.message });
        return { status: 'none', attempts: 0 };
      })
      .finally(() => this.#walking.delete(isbn13));
    this.#walking.set(isbn13, walk);
    return walk;
  }

  async #walk(isbn13, providedRecord) {
    const record = providedRecord ?? await this.#loadRecord(isbn13);
    const book = { ...(record ?? {}), isbn13 };
    const tried = [];
    let attempts = 0;

    for (const candidate of coverCandidates(book)) {
      attempts += 1;
      const result = await this.#coverArt.fetch(candidate.url);
      if (result.usable) {
        this.#store.save(isbn13, { ...result, source: candidate.source, url: candidate.url, attempts });
        this.#logger.info?.('books.cover.found', {
          isbn13, source: candidate.source, attempts, width: result.width, height: result.height,
        });
        return { status: 'found', source: candidate.source, url: candidate.url, attempts, tried };
      }
      tried.push(`${candidate.source}:${result.reason}`);
    }

    // The last rung: no catalogue had it, so ask what the web has. Deliberately
    // last — an image search is the only rung that can return the WRONG book.
    const query = coverSearchQuery(book);
    if (query && this.#coverArt.canSearch) {
      const links = await this.#coverArt.searchImages(query, { limit: this.#searchLimit });
      for (const url of links.slice(0, this.#searchLimit)) {
        attempts += 1;
        const result = await this.#coverArt.fetch(url);
        if (result.usable) {
          this.#store.save(isbn13, { ...result, source: 'image-search', url, attempts });
          this.#logger.info?.('books.cover.found', { isbn13, source: 'image-search', attempts, query });
          return { status: 'found', source: 'image-search', url, attempts, tried };
        }
        tried.push(`image-search:${result.reason}`);
      }
    }

    this.#store.saveMiss(isbn13, {
      attempts, tried,
      retryAfter: new Date(this.#clock().getTime() + this.#retryMs).toISOString(),
    });
    return { status: 'none', attempts, tried };
  }

  async #loadRecord(isbn13) {
    if (!this.#repository) return null;
    try {
      return await this.#repository.findByIsbn(isbn13);
    } catch (error) {
      this.#logger.warn?.('books.cover.record-read-failed', { isbn13, error: error.message });
      return null;
    }
  }

  /** A miss whose retry date has not arrived: settled, do not re-walk. */
  #settledMiss(isbn13) {
    const meta = this.#store.readMeta(isbn13);
    if (!meta || meta.file) return false;
    const retryAt = Date.parse(meta.retryAfter ?? '');
    if (!Number.isFinite(retryAt)) return true;
    return this.#clock().getTime() < retryAt;
  }
}

export default ResolveBookCover;
