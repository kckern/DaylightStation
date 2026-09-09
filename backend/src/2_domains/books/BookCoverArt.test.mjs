import { describe, it, expect } from 'vitest';
import {
  coverCandidates, coverSearchQuery, judgeCoverImage, readImageHeader,
  normaliseCoverUrl, coverExtension, MIN_COVER_BYTES,
} from './BookCoverArt.mjs';

/** A buffer that looks like `format` at `width` x `height`, padded to `bytes`. */
function fakeImage(format, width, height, bytes = MIN_COVER_BYTES + 1) {
  const head = Buffer.alloc(64);
  if (format === 'png') {
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(width, 16); head.writeUInt32BE(height, 20);
  } else if (format === 'gif') {
    head.write('GIF89a', 0, 'ascii');
    head.writeUInt16LE(width, 6); head.writeUInt16LE(height, 8);
  } else {
    // JPEG: SOI, then one SOF0 segment carrying the dimensions.
    head.writeUInt16BE(0xffd8, 0);
    head.writeUInt16BE(0xffc0, 2); head.writeUInt16BE(11, 4);
    head.writeUInt8(8, 6); head.writeUInt16BE(height, 7); head.writeUInt16BE(width, 9);
  }
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 0x42)]);
}

describe('readImageHeader', () => {
  it.each([['jpeg', 342, 500], ['png', 128, 170], ['gif', 1, 1]])('measures a %s', (format, width, height) => {
    expect(readImageHeader(fakeImage(format, width, height))).toEqual({ format, width, height });
  });

  it('answers null for something that is not an image at all', () => {
    expect(readImageHeader(Buffer.from('<!doctype html><html>we are down</html>'))).toBeNull();
  });
});

describe('judgeCoverImage', () => {
  it('accepts a real cover', () => {
    expect(judgeCoverImage({ contentType: 'image/jpeg', bytes: fakeImage('jpeg', 342, 500, 69247) }))
      .toMatchObject({ usable: true, reason: null, width: 342, height: 500 });
  });

  // The two sentinels this module exists for, measured 2026-09-09.
  it("rejects Amazon's 43-byte 1x1 dot", () => {
    const dot = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0]), Buffer.alloc(33)]);
    expect(judgeCoverImage({ contentType: 'image/gif', bytes: dot }))
      .toMatchObject({ usable: false, reason: 'too-few-bytes' });
  });

  it("rejects Google's 1269-byte grey rectangle, whose DIMENSIONS are plausible", () => {
    const verdict = judgeCoverImage({ contentType: 'image/png', bytes: fakeImage('png', 128, 170, 1269) });
    // 128x170 passes any size test; only the byte count gives it away.
    expect(verdict).toMatchObject({ usable: false, reason: 'too-few-bytes', width: 128, height: 170 });
  });

  it('rejects an error page served as 200', () => {
    expect(judgeCoverImage({ contentType: 'text/html', bytes: Buffer.alloc(20000, 0x20) }))
      .toMatchObject({ usable: false, reason: 'not-an-image' });
  });

  it('rejects a big image that is still a tracking pixel', () => {
    expect(judgeCoverImage({ contentType: 'image/png', bytes: fakeImage('png', 1, 1, 40000) }))
      .toMatchObject({ usable: false, reason: 'too-small' });
  });
});

describe('coverCandidates', () => {
  const book = {
    isbn13: '9780064400558', isbn10: '0064400557',
    olEditionKey: 'OL7647825M', googleVolumeId: 'H_v1zAEACAAJ', coverUrl: null,
  };

  it('ladders OpenLibrary, then Amazon, then Google', () => {
    expect(coverCandidates(book).map((c) => c.source))
      .toEqual(['openlibrary-isbn', 'openlibrary-olid', 'amazon', 'googlebooks']);
  });

  it('always disables the OpenLibrary placeholder, which is the only thing that makes a miss a 404', () => {
    for (const candidate of coverCandidates(book)) {
      if (/openlibrary/.test(candidate.source)) expect(candidate.url).toContain('default=false');
    }
  });

  it("puts the record's own OpenLibrary cover id first — it names the exact edition", () => {
    const withCover = { ...book, coverUrl: 'https://covers.openlibrary.org/b/id/405630-L.jpg' };
    expect(coverCandidates(withCover)[0])
      .toEqual({ source: 'record', url: 'https://covers.openlibrary.org/b/id/405630-L.jpg' });
  });

  it("ranks a stored 128px Google thumbnail BELOW the 500px sources", () => {
    const google = 'https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1';
    const sources = coverCandidates({ ...book, coverUrl: google }).map((c) => c.source);
    expect(sources.indexOf('record')).toBeGreaterThan(sources.indexOf('amazon'));
  });

  it('never repeats a url', () => {
    const urls = coverCandidates({ ...book, coverUrl: `https://covers.openlibrary.org/b/isbn/${book.isbn13}-L.jpg?default=false` })
      .map((c) => c.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('offers nothing at all for a book with no identifiers', () => {
    expect(coverCandidates({})).toEqual([]);
  });

  it('upgrades a stored http url rather than dropping it', () => {
    expect(coverCandidates({ isbn13: '', coverUrl: 'http://example.test/c.jpg' })[0].url)
      .toBe('https://example.test/c.jpg');
  });
});

describe('coverSearchQuery', () => {
  it('quotes the title and says what kind of picture it wants', () => {
    expect(coverSearchQuery({ title: 'Pie', authors: ['Sarah Weeks'] })).toBe('"Pie" Sarah Weeks book cover');
  });

  it('is null without a title — an author alone would search for a person', () => {
    expect(coverSearchQuery({ authors: ['Sarah Weeks'] })).toBeNull();
  });
});

describe('the small print', () => {
  it('refuses a data: or javascript: url outright', () => {
    expect(normaliseCoverUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseCoverUrl('data:image/png;base64,AAAA')).toBeNull();
  });

  it('names the file after what the bytes turned out to be, not what was promised', () => {
    expect(coverExtension({ format: 'png', contentType: 'image/jpeg' })).toBe('png');
    expect(coverExtension({ format: null, contentType: 'image/webp' })).toBe('webp');
    expect(coverExtension({})).toBe('jpg');
  });
});
