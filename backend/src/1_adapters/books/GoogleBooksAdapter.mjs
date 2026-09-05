// backend/src/1_adapters/books/GoogleBooksAdapter.mjs

import { IBookMetadataGateway } from '#apps/books/ports/IBookMetadataGateway.mjs';
import { parseBookIdentifier } from '#domains/books/BookIdentifier.mjs';
import { createBookRecord } from '#domains/books/BookRecord.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';

/**
 * GoogleBooksAdapter — a DESCRIPTION source, not a spine.
 *
 * Measured 2026-09-02 against the three books this design was tested on, and
 * the results are why this adapter's job is deliberately narrow:
 *
 * | Book              | Google pageCount | Google title                        |
 * |-------------------|------------------|-------------------------------------|
 * | Guys from Space   | 0 (really 32)    | correct                             |
 * | Narnia            | 0 (really 206)   | "…Wardrobe (rack)"                  |
 * | Charlotte's Web   | 196 (really 184) | "Charlotte's Web Book and Charm"    |
 *
 * Two of three page counts were zero and two of three titles were packaging
 * variants. Google earns its place because it had a real DESCRIPTION for all
 * three, including the long-tail *Guys from Space*. The field-precedence table
 * in `2_domains/books/BookRecord` encodes exactly that split; this adapter's
 * duty is to make sure the values it hands over are honest, so that table can
 * stay simple.
 *
 * ## THE TWO QUIRKS THAT DIE HERE
 *
 * 1. `pageCount: 0` is normalised to null. `createBookRecord` would catch it
 *    anyway, but a zero must not travel even that far: page count draws the
 *    shelf's progress bar, so a 0 winning a merge is a dead interaction.
 * 2. `items[0]` IS NOT THE BOOK. Google ranks a book-plus-charm bundle above
 *    the book. When any item declares the ISBN we asked for, that item wins;
 *    ranking is only a fallback.
 *
 * ## THE CALL IS BOUNDED
 *
 * `timeoutMs` (default 8000) rides the request as the HttpClient's abort
 * timeout, so a provider that never answers is a thrown failure — reported as
 * `unavailable` by `ResolveBook` — and not a 30s stare at "Looking it up…".
 *
 * ## KEYS
 *
 * Keyless requests share one anonymous project whose daily quota is routinely
 * spent — measured as HTTP 429 from two separate networks on 2026-09-02. A key
 * is therefore effectively required, but it stays OPTIONAL here: a keyless
 * lookup that succeeds is still a lookup, and the resolve chain treats a throw
 * as "this provider could not help", never as "no such book".
 *
 * @module adapters/books/GoogleBooksAdapter
 */

const BASE_URL = 'https://www.googleapis.com/books/v1';
const ISBN13 = /^\d{13}$/;
const DEFAULT_TIMEOUT_MS = 8000;

/** A four-digit year out of `'1989'` or `'2005-08-01'`. */
function yearFrom(value) {
  const match = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

/** Every ISBN an item declares, in either length. */
const declaredIsbns = (volumeInfo) => (volumeInfo?.industryIdentifiers ?? [])
  .map((entry) => entry?.identifier)
  .filter(Boolean);

/** ISBN-10 and ISBN-13 declarations reduced to the canonical ISBN-13 key. */
const canonicalDeclaredIsbns = (volumeInfo) => declaredIsbns(volumeInfo)
  .map((value) => parseBookIdentifier(String(value)))
  .filter((parsed) => parsed.kind === 'isbn')
  .map((parsed) => parsed.isbn13);

export class GoogleBooksAdapter extends IBookMetadataGateway {
  #baseUrl; #apiKey; #httpClient; #logger; #timeoutMs;

  constructor({ baseUrl = BASE_URL, apiKey = null, httpClient, logger = console, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#apiKey = apiKey || null;
    this.#logger = logger;
    this.#httpClient = httpClient || new HttpClient({ logger });
    this.#timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  get id() { return 'googlebooks'; }

  /**
   * @param {string} isbn13
   * @returns {Promise<object|null>}
   */
  async byIsbn(isbn13) {
    if (!ISBN13.test(String(isbn13 ?? ''))) {
      throw new TypeError(`GoogleBooksAdapter.byIsbn requires a canonical ISBN-13, got: ${isbn13}`);
    }

    const params = new URLSearchParams({ q: `isbn:${isbn13}` });
    if (this.#apiKey) params.set('key', this.#apiKey);

    const res = await this.#httpClient.requestRaw('GET', `${this.#baseUrl}/volumes?${params}`, {
      responseType: 'json',
      timeout: this.#timeoutMs,
    });
    if (!res.ok) {
      // A 429 is the common case and it is a BREAKAGE, not a miss. Reporting it
      // as "no such book" would cache a spent quota as a permanent absence.
      throw new Error(`GoogleBooks responded ${res.status} for ${isbn13}`);
    }

    const item = this.#pickItem(res.data?.items, isbn13);
    if (!item) {
      this.#logger.debug?.('books.googlebooks.miss', { isbn13 });
      return null;
    }

    const info = item.volumeInfo ?? {};
    return createBookRecord({
      source: this.id,
      isbn13,
      isbn10: declaredIsbns(info).find((value) => value.length === 10) ?? null,
      title: info.title ?? null,
      subtitle: info.subtitle ?? null,
      authors: info.authors ?? [],
      publisher: info.publisher ?? null,
      publishedYear: yearFrom(info.publishedDate),
      // Explicit, ahead of createBookRecord's own guard: this value has a
      // documented habit of being a lie, and the intent should be readable here.
      pageCount: info.pageCount > 0 ? info.pageCount : null,
      language: info.language ?? null,
      description: info.description ?? null,
      categories: info.categories ?? [],
      coverUrl: this.#cover(info),
      googleVolumeId: item.id ?? null,
      averageRating: info.averageRating ?? null,
      ratingCount: info.ratingsCount ?? null,
    });
  }

  /** An item declaring the ISBN we asked for beats whatever Google ranked first. */
  #pickItem(items, isbn13) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length === 0) return null;
    const exact = list.find((item) => canonicalDeclaredIsbns(item.volumeInfo).includes(isbn13));
    if (!exact) {
      this.#logger.debug?.('books.googlebooks.no-exact-isbn-match', { isbn13, candidates: list.length });
    }
    return exact ?? list[0];
  }

  /** Google serves thumbnails over http; the page that shows them is https. */
  #cover(info) {
    const links = info?.imageLinks ?? {};
    const url = links.extraLarge ?? links.large ?? links.medium ?? links.thumbnail ?? links.smallThumbnail;
    return url ? String(url).replace(/^http:\/\//i, 'https://') : null;
  }
}

export default GoogleBooksAdapter;
