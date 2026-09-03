/**
 * IBookMetadataGateway — one source's answer about one book, ALREADY IN OUR
 * SHAPE.
 *
 * ## THE ADAPTER DOES THE TRANSLATING. ALL OF IT.
 *
 * An implementation returns a COMPLETE `BookRecord` built by
 * `createBookRecord` — every field present, `null` for everything that
 * provider does not carry. Nothing provider-shaped escapes an adapter: no
 * `volumeInfo`, no `bibkeys` envelope, no `items[0]`, no raw MARC. By the time
 * a record crosses this boundary it is a native domain object, and a caller
 * cannot tell which provider produced it except by reading `sources`.
 *
 * The consequence that matters: every provider quirk is fixed ONCE, in the one
 * file that understands that provider, instead of being defended against
 * wherever records are consumed. Google's `pageCount: 0`, its packaging
 * variants ("Charlotte's Web Book and Charm"), OpenLibrary's split between an
 * edition record and the work record that actually holds the description —
 * those are each adapter-local problems and they stay there.
 *
 * So a gateway answers for ITSELF and says nothing about precedence. Which
 * source wins which field is one declarative table in
 * `2_domains/books/BookRecord`, applied generically. Merging never branches on
 * a provider name, because by then there is nothing provider-shaped left to
 * branch on.
 *
 * ## A MISS IS `null`; A BREAKAGE THROWS
 *
 * These are different outcomes and callers act on them differently. "This
 * provider has never heard of that ISBN" is an ordinary answer and returns
 * `null` — the resolve chain moves on and the book may still resolve from
 * somewhere else. "The provider is down, rate-limited, or returned something
 * unparseable" throws, so a partial record is never mistaken for a complete
 * one. Collapsing the two would mean a 429 from Google looked exactly like a
 * book Google does not carry, and the record would be quietly filed as
 * description-less forever.
 *
 * ## FIELDS ARE ABSENT, NOT ZERO
 *
 * An implementation MUST return `null` for a field it does not know, and must
 * never substitute a falsy stand-in. This is not pedantry: on
 * 2026-09-02 Google Books returned `pageCount: 0` for two of three test books
 * (Narnia, *Guys from Space*) that OpenLibrary knew were 208 and 32 pages. A
 * zero page count reaching the shelf disables the progress bar — the single
 * interaction the whole product is built on — so `0` is normalised to absent at
 * the adapter boundary, where the provider's quirk is understood, rather than
 * defended against in five places downstream.
 *
 * Layer: APPLICATION port (3_applications/books/ports).
 *
 * @module applications/books/ports/IBookMetadataGateway
 */

/** @typedef {import('#domains/books/BookRecord.mjs').BookRecord} BookRecord */

export class IBookMetadataGateway {
  /**
   * Short, stable provider id — `'openlibrary'`, `'googlebooks'`. It is
   * recorded in the resolved record's `sources[]` so a support question
   * ("why does this book have no cover?") is answerable without a re-fetch,
   * and it is the key the field-precedence table is written against.
   * @returns {string}
   */
  get id() {
    throw new Error('IBookMetadataGateway.id must be implemented');
  }

  /**
   * @param {string} isbn13 - canonical, already validated by `parseBookIdentifier`
   * @returns {Promise<BookRecord|null>} a COMPLETE record from `createBookRecord`
   *   (nulls for whatever this provider lacks), or null when this provider has
   *   no such book at all. Throws when the provider itself failed.
   */
  async byIsbn() {
    throw new Error('IBookMetadataGateway.byIsbn not implemented');
  }

  /**
   * OPTIONAL. Providers that have no concept of an OpenLibrary work may leave
   * the base implementation in place; the resolve chain treats `null` as "this
   * provider cannot help with that lookup", exactly as it treats a miss.
   * @param {string} workKey
   * @returns {Promise<BookRecord|null>}
   */
  async byWorkKey() {
    return null;
  }
}

export default IBookMetadataGateway;
