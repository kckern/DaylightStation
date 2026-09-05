// backend/src/1_adapters/books/OpenLibraryAdapter.mjs

import { IBookMetadataGateway } from '#apps/books/ports/IBookMetadataGateway.mjs';
import { createBookRecord } from '#domains/books/BookRecord.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';

/**
 * OpenLibraryAdapter — the spine of book lookup, translated into our model.
 *
 * Keyless and unauthenticated. Everything OpenLibrary-shaped is resolved here;
 * a caller sees only a `BookRecord`.
 *
 * ## IT TAKES TWO CALLS, AND THAT IS NOT AN OPTIMISATION TO REMOVE
 *
 * `/api/books?jscmd=data` returns the edition — title, authors, page count,
 * subjects, characters — and **no description field at all**. Measured
 * 2026-09-02 for both *Narnia* and *Guys from Space*: the description lives on
 * the WORK record, one hop further on. A single-call implementation renders
 * every book with a blank description, which is exactly the field a child uses
 * to confirm they scanned the right book.
 *
 * The work fetch is nonetheless BEST-EFFORT. A book with no description is a
 * book; a failed enrichment call must never cost the record that already
 * resolved. Compare the edition call, which throws — see below.
 *
 * ## A MISS IS `null`; A BREAKAGE THROWS
 *
 * An empty `/api/books` envelope means OpenLibrary has no such ISBN, and the
 * chain moves on. A transport failure or a 429 throws, so a rate limit is never
 * mistaken for a book that does not exist and cached as description-less.
 *
 * ## EVERY CALL IS BOUNDED
 *
 * `timeoutMs` (default 8000) rides every request as the HttpClient's abort
 * timeout. A provider that never answers is otherwise a child staring at
 * "Looking it up…" for the client's 30s default; bounded, it becomes a thrown
 * failure that `ResolveBook` reports as `unavailable` like any other break.
 *
 * ## SHAPES NORMALISED HERE
 *
 * - `[{name}]` lists (`authors`, `subjects`, `subject_people`) become `[string]`
 * - `[{text, comment}]` excerpts become `[string]`
 * - a work `description` may be a bare string OR `{type, value}` — both accepted
 * - `publish_date: 'September 1, 1994'` becomes `publishedYear: 1994`
 * - a MARC series line, `'The Chronicles of Narnia -- bk. 2'`, becomes
 *   `series: 'The Chronicles of Narnia'` + `seriesVolume: 2`
 *
 * @module adapters/books/OpenLibraryAdapter
 */

const BASE_URL = 'https://openlibrary.org';
const ISBN13 = /^\d{13}$/;
const DEFAULT_TIMEOUT_MS = 8000;

/** `[{name: 'Aslan'}]` -> `['Aslan']`. Also tolerates a plain string list. */
const names = (list) => (Array.isArray(list) ? list : [])
  .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
  .filter(Boolean);

/** OpenLibrary text fields are sometimes `{type, value}`, sometimes a string. */
const text = (value) => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.value === 'string') return value.value;
  return null;
};

/** `/works/OL84048W` -> `OL84048W`. */
const lastSegment = (key) => (typeof key === 'string' ? key.split('/').filter(Boolean).at(-1) : null);

/** A four-digit year out of anything from `'1989'` to `'September 1, 1994'`. */
function yearFrom(value) {
  const match = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

/**
 * Split a MARC series statement into a name and a volume.
 * `'The Chronicles of Narnia -- bk. 2'` -> `{series, seriesVolume}`.
 * Cataloguers vary the punctuation, so anything unrecognised keeps the whole
 * string as the name rather than being dropped.
 */
function splitSeries(raw) {
  const value = typeof raw === 'string' ? raw.trim() : null;
  if (!value) return { series: null, seriesVolume: null };
  const match = /^(.*?)\s*(?:--|;|,)?\s*(?:bk\.?|book|v\.?|vol\.?|volume|no\.?)\s*(\d+)\s*$/i.exec(value);
  if (!match) return { series: value.replace(/\s*--\s*$/, ''), seriesVolume: null };
  return { series: match[1].replace(/\s*--\s*$/, '').trim(), seriesVolume: Number(match[2]) };
}

export class OpenLibraryAdapter extends IBookMetadataGateway {
  #baseUrl; #httpClient; #logger; #timeoutMs;

  constructor({ baseUrl = BASE_URL, httpClient, logger = console, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#logger = logger;
    this.#httpClient = httpClient || new HttpClient({ logger });
    this.#timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  get id() { return 'openlibrary'; }

  /**
   * @param {string} isbn13
   * @returns {Promise<object|null>}
   */
  async byIsbn(isbn13) {
    if (!ISBN13.test(String(isbn13 ?? ''))) {
      // The domain validates identifiers (`parseBookIdentifier`); reaching an
      // adapter with a non-canonical one is a wiring bug, not a user typo, and
      // must not become a network call.
      throw new TypeError(`OpenLibraryAdapter.byIsbn requires a canonical ISBN-13, got: ${isbn13}`);
    }

    const envelope = await this.#get(`/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`);
    const edition = envelope?.[`ISBN:${isbn13}`];
    if (!edition) {
      this.#logger.debug?.('books.openlibrary.miss', { isbn13 });
      return null;
    }

    const enrichment = await this.#enrich(isbn13);

    return createBookRecord({
      source: this.id,
      isbn13,
      isbn10: edition.identifiers?.isbn_10?.[0] ?? null,
      title: edition.title ?? null,
      subtitle: edition.subtitle ?? null,
      authors: names(edition.authors),
      publisher: names(edition.publishers)[0] ?? null,
      publishedYear: yearFrom(edition.publish_date),
      pageCount: edition.number_of_pages ?? null,
      description: enrichment.description,
      subjects: names(edition.subjects),
      people: names(edition.subject_people),
      places: names(edition.subject_places),
      excerpts: (edition.excerpts ?? []).map((entry) => text(entry?.text)).filter(Boolean),
      // A syntactically plausible Covers URL still returns a placeholder when
      // OpenLibrary has no art. Trust the edition's explicit cover object so a
      // lower-precedence provider with real art can win the merge.
      coverUrl: this.#cover(edition),
      olEditionKey: edition.identifiers?.openlibrary?.[0] ?? null,
      olWorkKey: enrichment.workKey,
      wikipediaUrl: (edition.links ?? []).map((l) => l?.url).find((u) => /wikipedia\.org/i.test(u ?? '')) ?? null,
      series: enrichment.series,
      seriesVolume: enrichment.seriesVolume,
    });
  }

  #cover(edition) {
    const cover = edition?.cover ?? {};
    const url = cover.large ?? cover.medium ?? cover.small;
    return url ? String(url).replace(/^http:\/\//i, 'https://') : null;
  }

  /**
   * The second hop: the edition record names the work, and the work record
   * holds the description. Best-effort throughout — every failure degrades to
   * "no description" rather than losing the book.
   */
  async #enrich(isbn13) {
    const blank = { description: null, workKey: null, series: null, seriesVolume: null };
    let editionRecord;
    try {
      editionRecord = await this.#get(`/isbn/${isbn13}.json`);
    } catch (error) {
      this.#logger.warn?.('books.openlibrary.edition-record-failed', { isbn13, error: error.message });
      return blank;
    }
    const { series, seriesVolume } = splitSeries(editionRecord?.series?.[0]);
    const workKey = lastSegment(editionRecord?.works?.[0]?.key);
    if (!workKey) return { ...blank, series, seriesVolume };

    try {
      const work = await this.#get(`/works/${workKey}.json`);
      return { description: text(work?.description), workKey, series, seriesVolume };
    } catch (error) {
      this.#logger.warn?.('books.openlibrary.work-fetch-failed', { isbn13, workKey, error: error.message });
      return { ...blank, workKey, series, seriesVolume };
    }
  }

  async #get(path) {
    const res = await this.#httpClient.requestRaw('GET', `${this.#baseUrl}${path}`, {
      // OpenLibrary asks callers to identify themselves; an anonymous client is
      // the first thing rate-limited.
      headers: { 'User-Agent': 'DaylightStation/1.0 (household reading log)' },
      responseType: 'json',
      timeout: this.#timeoutMs,
    });
    if (!res.ok) throw new Error(`OpenLibrary ${path} responded ${res.status}`);
    return res.data;
  }
}

export default OpenLibraryAdapter;
