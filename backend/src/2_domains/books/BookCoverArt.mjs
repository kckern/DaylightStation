/**
 * BookCoverArt — which URLs might hold a book's cover, and whether the bytes
 * that came back are actually one.
 *
 * ## A COVER URL IS NOT A COVER
 *
 * This module exists because every provider answers `200 OK` for a book it has
 * no art for. Measured 2026-09-09 against the household's own shelf:
 *
 * | Provider      | "No art" answer                    | Bytes | Pixels  |
 * |---------------|------------------------------------|-------|---------|
 * | Amazon        | `image/gif`, a transparent dot     |    43 | 1 x 1   |
 * | Google Books  | `image/png`, a grey gradient       |  1269 | 128x170 |
 * | OpenLibrary   | 404, but ONLY with `default=false` |     - | -       |
 *
 * The Google sentinel is the instructive one: 128x170 is a perfectly plausible
 * thumbnail size, so a dimension test alone passes it. What gives it away is
 * that 21,760 pixels arrived in 1,269 bytes. Hence three tests, not one — type,
 * size, and a byte floor — and hence the OpenLibrary URLs below always carry
 * `default=false`, which converts a placeholder into an honest 404.
 *
 * ## THE LADDER IS ORDERED FOR QUALITY, NOT JUST FOR COVERAGE
 *
 * A blank tile is the failure this ladder exists to prevent, but a 128px
 * Google thumbnail stretched across a tile is the failure the ORDER prevents.
 * OpenLibrary `-L` (typically 400-500px) and Amazon `LZZZZZZZ` (500px) come
 * before Google's `zoom=1` (128px), so the shelf takes the best art anyone has
 * rather than the first art anyone has.
 *
 * Coverage measured on the four covers the shelf was blank for:
 * OpenLibrary-by-ISBN found *Charlotte's Web* (69KB) that OpenLibrary's own
 * edition record had no `cover` object for; Amazon found a Korean edition of
 * *Tintin* (52KB) that nothing else had. Two blanks left, and those are what
 * the image search at the bottom of the ladder is for.
 *
 * Layer: DOMAIN (2_domains/books). Imports nothing.
 *
 * @module domains/books/BookCoverArt
 */

/** Below this, the bytes are a sentinel however plausible the dimensions. */
export const MIN_COVER_BYTES = 3000;
/** Below this on either edge, it is a tracking dot, not a cover. */
export const MIN_COVER_EDGE = 50;

const ISBN13 = /^\d{13}$/;
const ISBN10 = /^\d{9}[\dXx]$/;
const OL_KEY = /^OL\d+[MW]$/i;

const trim = (value) => (typeof value === 'string' ? value.trim() : '');

/** Upgrade a provider URL to https and refuse anything else outright. */
export function normaliseCoverUrl(value) {
  const raw = trim(value);
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:/i, 'https:');
  if (/^\/\/[^/]/.test(raw)) return `https:${raw}`;
  return null;
}

/**
 * Every place this book's art might live, best first.
 *
 * Pure and offline: it constructs URLs, it does not fetch them. `ResolveBookCover`
 * walks the list and stops at the first one whose BYTES pass `judgeCoverImage`.
 *
 * @param {object} record - a BookRecord (or anything carrying its id fields)
 * @returns {Array<{source: string, url: string}>} de-duplicated, in ladder order
 */
export function coverCandidates(record = {}) {
  const isbn13 = trim(record.isbn13);
  const isbn10 = trim(record.isbn10);
  const olEditionKey = trim(record.olEditionKey);
  const stored = normaliseCoverUrl(record.coverUrl);
  const volumeId = trim(record.googleVolumeId);

  const candidates = [];
  const add = (source, url) => { if (url) candidates.push({ source, url }); };

  // The record's own answer FIRST when it is an OpenLibrary cover id: that URL
  // names the exact edition a provider matched, which is more precise than
  // asking the covers service to resolve the ISBN itself.
  if (stored && /covers\.openlibrary\.org/i.test(stored)) add('record', stored);

  if (ISBN13.test(isbn13)) add('openlibrary-isbn', `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`);
  if (OL_KEY.test(olEditionKey)) add('openlibrary-olid', `https://covers.openlibrary.org/b/olid/${olEditionKey.toUpperCase()}-L.jpg?default=false`);
  // Amazon indexes by ISBN-10 only. `LZZZZZZZ` is the large variant; the
  // medium one (`MZZZZZZZ`) measured 6.8KB against the large one's 48KB.
  if (ISBN10.test(isbn10)) add('amazon', `https://images-na.ssl-images-amazon.com/images/P/${isbn10.toUpperCase()}.01.LZZZZZZZ.jpg`);
  if (stored) add('record', stored);
  if (volumeId) add('googlebooks', `https://books.google.com/books/content?id=${encodeURIComponent(volumeId)}&printsec=frontcover&img=1&zoom=1`);

  const seen = new Set();
  return candidates.filter(({ url }) => (seen.has(url) ? false : seen.add(url)));
}

/**
 * The query an image search is asked when every catalogue has failed.
 * Quoted title plus one author plus the words a cover result is titled with —
 * bare title text alone returns author photographs and film stills.
 *
 * @returns {string|null} null when the record has no title to search on
 */
export function coverSearchQuery(record = {}) {
  const title = trim(record.title);
  if (!title) return null;
  const author = trim(Array.isArray(record.authors) ? record.authors[0] : '');
  return [`"${title}"`, author, 'book cover'].filter(Boolean).join(' ');
}

/**
 * Width and height straight out of an image header, without decoding it.
 *
 * Covers the four formats these providers actually serve. An unrecognised
 * format answers null, which `judgeCoverImage` treats as "cannot measure" and
 * falls back to the byte floor alone rather than rejecting art we simply
 * cannot read the header of.
 *
 * @param {Buffer|Uint8Array} bytes
 * @returns {{format: string, width: number, height: number}|null}
 */
export function readImageHeader(bytes) {
  if (!bytes || bytes.length < 16) return null;
  const b = bytes;
  const u16be = (i) => (b[i] << 8) | b[i + 1];
  const u32be = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

  // PNG: IHDR is always the first chunk.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { format: 'png', width: u32be(16), height: u32be(20) };
  }
  // GIF: logical screen descriptor, little-endian.
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { format: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  // WebP (VP8X / VP8L / VP8 ).
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X') {
      return { format: 'webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    if (chunk === 'VP8 ') {
      return { format: 'webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG: walk the segment chain to the first start-of-frame.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) { offset += 1; continue; }
      const marker = b[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = u16be(offset + 2);
      if (length < 2) break;
      // SOF0..SOF15, minus the DHT/JPG/DAC markers interleaved in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', height: u16be(offset + 5), width: u16be(offset + 7) };
      }
      offset += 2 + length;
    }
    return { format: 'jpeg', width: 0, height: 0 };
  }
  return null;
}

/**
 * Is this actually a cover, or is it the provider's way of saying no?
 *
 * @param {{contentType?: string, bytes?: Buffer|Uint8Array}} response
 * @returns {{usable: boolean, reason: string|null, format: string|null,
 *   width: number|null, height: number|null, byteLength: number}}
 */
export function judgeCoverImage({ contentType = '', bytes = null } = {}) {
  const byteLength = bytes?.length ?? 0;
  const header = readImageHeader(bytes);
  const measured = header && header.width > 0 && header.height > 0 ? header : null;
  const verdict = {
    reason: null,
    format: header?.format ?? null,
    width: measured?.width ?? null,
    height: measured?.height ?? null,
    byteLength,
  };

  // An HTML error page served as 200 is a provider outage wearing a cover's URL.
  if (!/^image\//i.test(String(contentType)) && !header) {
    return { ...verdict, usable: false, reason: 'not-an-image' };
  }
  if (byteLength < MIN_COVER_BYTES) {
    // The whole point: 43 bytes (Amazon) and 1269 bytes (Google) both land here.
    return { ...verdict, usable: false, reason: 'too-few-bytes' };
  }
  if (measured && (measured.width < MIN_COVER_EDGE || measured.height < MIN_COVER_EDGE)) {
    return { ...verdict, usable: false, reason: 'too-small' };
  }
  return { ...verdict, usable: true };
}

/** The file extension a stored cover gets, from what the bytes turned out to be. */
export function coverExtension({ format = null, contentType = '' } = {}) {
  const known = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp' };
  if (known[format]) return known[format];
  const match = /^image\/(jpeg|jpg|png|gif|webp)/i.exec(String(contentType));
  return match ? known[match[1].toLowerCase()] ?? match[1].toLowerCase() : 'jpg';
}

/** The content type a stored cover is served back with. */
export function coverContentType(extension) {
  const types = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return types[String(extension).toLowerCase()] ?? 'application/octet-stream';
}

export default coverCandidates;
