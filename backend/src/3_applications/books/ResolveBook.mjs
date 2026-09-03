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
 * ## THE CACHE IS A REPOSITORY, NOT A TTL
 *
 * Household reading repeats heavily — siblings, re-reads — and a cached record
 * means an OpenLibrary outage cannot stop a child logging a book the house has
 * seen before. Records are refreshed on demand (`refresh: true`), never expired
 * out from under a log entry that points at them.
 *
 * Layer: APPLICATION (3_applications/books).
 *
 * @module applications/books/ResolveBook
 */
export class ResolveBook {
  #gateways; #repository; #libraryCatalog; #logger;

  /**
   * @param {object} deps
   * @param {Array<import('./ports/IBookMetadataGateway.mjs').IBookMetadataGateway>} deps.gateways
   * @param {object} [deps.repository] - IBookRepository; omit to disable caching
   * @param {object} [deps.libraryCatalog] - ILibraryCatalogGateway
   */
  constructor({ gateways = [], repository = null, libraryCatalog = null, logger = console } = {}) {
    this.#gateways = gateways.filter(Boolean);
    this.#repository = repository;
    this.#libraryCatalog = libraryCatalog;
    this.#logger = logger;
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

    if (!refresh && this.#repository) {
      const cached = await this.#repository.findByIsbn(isbn13);
      if (cached) return { status: 'ok', book: cached, fromCache: true };
    }

    const { records, failures } = await this.#ask(isbn13);

    if (records.length === 0) {
      // Everything broke vs nobody had it. Conflating these caches an outage.
      const status = failures.length > 0 ? 'unavailable' : 'not-found';
      this.#logger.info?.(`books.resolve.${status}`, { isbn13, failures: failures.length });
      return { status, ...(failures.length ? { failures } : {}) };
    }

    const merged = mergeBookRecords(
      libraryRecordId
        ? [...records, createBookRecord({ source: 'library', isbn13, libraryRecordId })]
        : records,
    );

    if (this.#repository) await this.#repository.save(merged);

    this.#logger.info?.('books.resolve.ok', {
      isbn13, sources: merged.sources, failures: failures.length,
    });
    return { status: 'ok', book: merged, ...(failures.length ? { failures } : {}) };
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
