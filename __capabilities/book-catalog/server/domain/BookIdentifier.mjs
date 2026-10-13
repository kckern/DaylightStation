/**
 * What a child is holding, read off the object itself.
 *
 * A book is never searched for in this house (§5.2 B9) — it is identified by a
 * number printed on the thing in your hands. This module is the whole of that
 * step: one string in, one classified identifier out, no network, no I/O.
 *
 * IT CLASSIFIES; IT DOES NOT RESOLVE. Naming the owner and stopping there is
 * the same discipline `scan/ScanCode.mjs` keeps, and for the same reason: the
 * shape of a code is knowable offline and cheaply, so a malformed number must
 * never cost a network call (B2).
 *
 * ISBN-13 IS THE CANONICAL KEY (B3). An ISBN-10 is converted rather than
 * carried as an alternative spelling, so the same book typed off a copyright
 * page in March and scanned off a back cover in June is ONE book. The original
 * ten-digit form is returned alongside, because it is what the child can see
 * and what an error message may need to quote back.
 *
 * EVERY FAILURE IS NAMED. `kind: 'invalid'` always carries a `reason`, because
 * the screen has to tell a child something better than "not found" — a bad
 * check digit means "check the number", while a 14-digit code means "that's the
 * library's sticker, flip the book over" (B11). Those are different sentences
 * and they are decided here.
 *
 * Layer: DOMAIN (2_domains/books). Imports nothing.
 *
 * @module domains/books/BookIdentifier
 */

/** 978/979. A 13-digit code behind anything else is a product, not a book. */
const BOOKLAND = ['978', '979'];

/** BiblioCommons record ids, as seen in a `/v2/record/<id>` path. */
const LIBRARY_RECORD = /^S\d+C\d+$/i;

/** OpenLibrary keys: `W` is a work, `M` an edition (a "manifestation"). */
const OL_WORK = /^OL\d+W$/i;
const OL_EDITION = /^OL\d+M$/i;

/**
 * Pull the last meaningful path segment out of a pasted URL.
 * Returns null for anything that is not a URL, so the caller falls through to
 * treating the input as a bare identifier.
 */
function segmentFromUrl(raw) {
  if (!/^https?:\/\//i.test(raw)) return null;
  const withoutQuery = raw.split(/[?#]/, 1)[0];
  const segments = withoutQuery.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (!last) return null;
  // `/works/OL15626917W.json` — the extension is ours to drop, not the id's.
  return last.replace(/\.(json|html?)$/i, '');
}

/** ISBN-13 check digit: alternating 1/3 weights over the first twelve digits. */
function isbn13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** ISBN-10 is valid when the 10..1 weighted sum is divisible by 11; X counts as 10. */
function isValidIsbn10(value) {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = value[i];
    const digit = char === 'X' ? 10 : Number(char);
    if (!Number.isInteger(digit)) return false;
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

/** The 978-prefixed ISBN-13 for a valid ISBN-10. */
function isbn10To13(isbn10) {
  const body = `978${isbn10.slice(0, 9)}`;
  return `${body}${isbn13CheckDigit(body)}`;
}

/**
 * Classify one identifier.
 *
 * @param {unknown} input - whatever was typed, scanned or pasted
 * @returns {{kind: 'isbn', isbn13: string, isbn10?: string, raw: string}
 *   | {kind: 'library-record', recordId: string, raw: string}
 *   | {kind: 'openlibrary-work', workKey: string, raw: string}
 *   | {kind: 'openlibrary-edition', editionKey: string, raw: string}
 *   | {kind: 'invalid', reason: string, raw: string}
 *   | {kind: 'empty', raw: string}}
 *   Never throws. `raw` is the TRIMMED input, because scanners append CR/LF and
 *   every caller wants the trimmed form.
 */
export function parseBookIdentifier(input) {
  // A non-string is not something a child typed; it is a caller bug upstream,
  // and answering it with `empty` keeps this function total (it never throws)
  // without inventing a book.
  if (typeof input !== 'string') return { kind: 'empty', raw: '' };
  const raw = input.trim();
  if (!raw) return { kind: 'empty', raw: '' };

  const candidate = segmentFromUrl(raw) ?? raw;

  if (LIBRARY_RECORD.test(candidate)) {
    return { kind: 'library-record', recordId: candidate.toUpperCase(), raw };
  }
  if (OL_WORK.test(candidate)) {
    return { kind: 'openlibrary-work', workKey: candidate.toUpperCase(), raw };
  }
  if (OL_EDITION.test(candidate)) {
    return { kind: 'openlibrary-edition', editionKey: candidate.toUpperCase(), raw };
  }

  // Hyphens and spaces are how humans and copyright pages write an ISBN; they
  // carry no information, so they are removed before anything is judged.
  const compact = candidate.replace(/[\s-]/g, '').toUpperCase();

  if (/^\d{13}$/.test(compact)) {
    if (!BOOKLAND.some((prefix) => compact.startsWith(prefix))) {
      return { kind: 'invalid', reason: 'not-a-book-prefix', raw };
    }
    if (Number(compact[12]) !== isbn13CheckDigit(compact.slice(0, 12))) {
      return { kind: 'invalid', reason: 'isbn13-checksum', raw };
    }
    return { kind: 'isbn', isbn13: compact, raw };
  }

  if (/^\d{9}[\dX]$/.test(compact)) {
    if (!isValidIsbn10(compact)) {
      return { kind: 'invalid', reason: 'isbn10-checksum', raw };
    }
    return { kind: 'isbn', isbn13: isbn10To13(compact), isbn10: compact, raw };
  }

  return { kind: 'invalid', reason: 'not-an-identifier', raw };
}

export default parseBookIdentifier;
