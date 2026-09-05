import { parseBookIdentifier } from '#domains/books/BookIdentifier.mjs';
import { createBookRecord, mergeBookRecords } from '#domains/books/BookRecord.mjs';

/**
 * ResolveBook — one identifier in, one book out.
 *
 * ## IT ORCHESTRATES; IT DOES NOT TRANSLATE
 *
 * Every provider quirk was already settled inside its adapter, and every
 * precedence question is settled by `mergeBookRecords`. What is left here is
 * genuinely only sequencing: validate, look in the cache, ask the providers,
 * merge, save. **There is no branch on a provider name anywhere in this file**,
 * and adding one would mean a quirk had escaped the boundary that was supposed
 * to contain it.
 *
 * ## FOUR OUTCOMES, DELIBERATELY DISTINGUISHED
 *
 * A screen a child reads has to say different things, so this returns different
 * things:
 *
 * - `invalid`     — the string is not an identifier. Never cost a network call.
 *                   Carries the domain's `reason`, so "check that number"
 *                   (`isbn13-checksum`) and "flip the book over"
 *                   (`not-an-identifier`, i.e. a library sticker) are separable.
 * - `not-found`   — a real identifier that nobody has heard of.
 * - `unavailable` — every provider BROKE. This is the one that must never be
 *                   shown as "no such book": a spent Google quota looks exactly
 *                   like an absent book unless the two are kept apart, and the
 *                   wrong one gets cached forever.
 * - `ok`          — a book, however thin.
 *
 * ## A PARTIAL RECORD IS A SUCCESS
 *
 * A book with no cover and no description still resolved, and a child who typed
 * a real ISBN deserves to see its title (B7). Only "no provider had it" is a
 * miss.
 *
 * ## THE CACHE IS DURABLE, WITH STALE-WHILE-REVALIDATE
 *
 * Household reading repeats heavily — siblings, re-reads — and a cached record
 * means an OpenLibrary outage cannot stop a child logging a book the house has
 * seen before. A current record returns immediately. After thirty days it
 * still returns immediately, then refreshes once in the background. The old
 * record participates in the merge so a partial provider outage cannot erase
 * a good cover, author, or description. `refresh: true` remains the explicit,
 * awaited repair path, and also keeps the old record if every provider fails.
 *
 * Layer: APPLICATION (3_applications/books).
 *
 * @module applications/books/ResolveBook
 */
export class ResolveBook {
  #gateways; #repository; #libraryCatalog; #logger; #clock; #refreshAfterMs;
  #refreshing = new Map();

  /**
   * @param {object} deps
   * @param {Array<import('./ports/IBookMetadataGateway.mjs').IBookMetadataGateway>} deps.gateways
   * @param {object} [deps.repository] - IBookRepository; omit to disable caching
   * @param {object} [deps.libraryCatalog] - ILibraryCatalogGateway
   */
  constructor({
    gateways = [], repository = null, libraryCatalog = null, logger = console,
    clock = () => new Date(), refreshAfterMs = 30 * 24 * 60 * 60 * 1000,
  } = {}) {
    this.#gateways = gateways.filter(Boolean);
    this.#repository = repository;
    this.#libraryCatalog = libraryCatalog;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
    this.#refreshAfterMs = Number.isFinite(refreshAfterMs) && refreshAfterMs >= 0
      ? refreshAfterMs
      : 30 * 24 * 60 * 60 * 1000;
  }

  /**
   * @param {string} identifier - anything printed on the object in a child's hands
   * @param {{refresh?: boolean}} [options]
   * @returns {Promise<{status: 'ok'|'not-found'|'invalid'|'unavailable', book?: object,
   *   reason?: string, failures?: Array<{source: string, error: string}>, fromCache?: boolean}>}
   */
  async execute(identifier, { refresh = false } = {}) {
    const parsed = parseBookIdentifier(identifier);

    if (parsed.kind === 'empty') return { status: 'invalid', reason: 'empty' };
    if (parsed.kind === 'invalid') return { status: 'invalid', reason: parsed.reason };

    const located = await this.#toIsbn(parsed);
    if (located.error) return located.error;

    const { isbn13, libraryRecordId } = located;

    const cachedEntry = await this.#cachedEntry(isbn13);
    const cached = cachedEntry?.book ?? null;
    if (!refresh && cached) {
      const stale = this.#isStale(cachedEntry);
      if (stale) this.#refreshInBackground({ isbn13, libraryRecordId, cached });
      return { status: 'ok', book: cached, fromCache: true, ...(stale ? { refreshing: true } : {}) };
    }

    const { records, failures } = await this.#ask(isbn13);

    if (records.length === 0) {
      // Everything broke vs nobody had it. Conflating these caches an outage.
      if (cached) {
        this.#logger.warn?.('books.resolve.refresh-kept-cache', { isbn13, failures: failures.length });
        return {
          status: 'ok', book: cached, fromCache: true, refreshFailed: true,
          ...(failures.length ? { failures } : {}),
        };
      }
      const status = failures.length > 0 ? 'unavailable' : 'not-found';
      this.#logger.info?.(`books.resolve.${status}`, { isbn13, failures: failures.length });
      return { status, ...(failures.length ? { failures } : {}) };
    }

    const merged = mergeBookRecords(
      libraryRecordId
        ? [...records, createBookRecord({ source: 'library', isbn13, libraryRecordId }), cached]
        : [...records, cached],
    );

    if (this.#repository) await this.#repository.save(merged);

    this.#logger.info?.('books.resolve.ok', {
      isbn13, sources: merged.sources, failures: failures.length,
    });
    return { status: 'ok', book: merged, ...(failures.length ? { failures } : {}) };
  }

  async #cachedEntry(isbn13) {
    if (!this.#repository) return null;
    // The explicit override check keeps simple test/dummy repositories that
    // inherit the port's compatibility method from being treated as freshness
    // aware when they do not persist a timestamp.
    const hasFreshnessRead = Object.prototype.hasOwnProperty.call(
      Object.getPrototypeOf(this.#repository) ?? {}, 'findByIsbnEntry',
    ) || Object.prototype.hasOwnProperty.call(this.#repository, 'findByIsbnEntry');
    if (hasFreshnessRead) return this.#repository.findByIsbnEntry(isbn13);
    const book = await this.#repository.findByIsbn(isbn13);
    return book ? { book, cachedAt: null, freshnessUnknown: true } : null;
  }

  #isStale(entry) {
    if (!entry || entry.freshnessUnknown) return false;
    const cachedMs = Date.parse(entry.cachedAt ?? '');
    if (!Number.isFinite(cachedMs)) return true;
    return this.#clock().getTime() - cachedMs >= this.#refreshAfterMs;
  }

  #refreshInBackground({ isbn13, libraryRecordId, cached }) {
    if (this.#refreshing.has(isbn13)) return;
    const refresh = (async () => {
      const { records, failures } = await this.#ask(isbn13);
      if (records.length === 0) {
        this.#logger.warn?.('books.resolve.background-refresh-kept-cache', { isbn13, failures: failures.length });
        return;
      }
      const merged = mergeBookRecords(
        libraryRecordId
          ? [...records, createBookRecord({ source: 'library', isbn13, libraryRecordId }), cached]
          : [...records, cached],
      );
      await this.#repository.save(merged);
      this.#logger.info?.('books.resolve.background-refreshed', { isbn13, failures: failures.length });
    })().catch((error) => {
      this.#logger.warn?.('books.resolve.background-refresh-failed', { isbn13, error: error.message });
    }).finally(() => this.#refreshing.delete(isbn13));
    this.#refreshing.set(isbn13, refresh);
  }

  /**
   * Reduce any accepted identifier to a canonical ISBN-13, which is the only
   * thing a metadata gateway is ever asked about.
   */
  async #toIsbn(parsed) {
    if (parsed.kind === 'isbn') return { isbn13: parsed.isbn13, libraryRecordId: null };

    if (parsed.kind === 'library-record') {
      if (!this.#libraryCatalog) {
        return { error: { status: 'not-found', reason: 'library-lookup-unavailable' } };
      }
      let hit = null;
      try {
        hit = await this.#libraryCatalog.byRecordId(parsed.recordId);
      } catch (error) {
        this.#logger.warn?.('books.resolve.library-failed', {
          recordId: parsed.recordId, error: error.message,
        });
        return { error: { status: 'unavailable', reason: 'library-lookup-failed' } };
      }
      if (!hit?.isbn13) {
        return { error: { status: 'not-found', reason: 'library-record-unresolved' } };
      }
      return { isbn13: hit.isbn13, libraryRecordId: parsed.recordId };
    }

    // OpenLibrary work/edition keys are a real identifier we cannot yet turn
    // into an ISBN. Saying so beats pretending the number was malformed.
    return { error: { status: 'not-found', reason: `unsupported-identifier:${parsed.kind}` } };
  }

  /** Ask every provider in parallel; a throw is a failure, a null is a miss. */
  async #ask(isbn13) {
    const settled = await Promise.all(this.#gateways.map(async (gatewayInstance) => {
      try {
        return { record: await gatewayInstance.byIsbn(isbn13) };
      } catch (error) {
        this.#logger.warn?.('books.resolve.provider-failed', {
          isbn13, source: gatewayInstance.id, error: error.message,
        });
        return { failure: { source: gatewayInstance.id, error: error.message } };
      }
    }));

    return {
      records: settled.map((entry) => entry.record).filter(Boolean),
      failures: settled.map((entry) => entry.failure).filter(Boolean),
    };
  }
}

export default ResolveBook;
