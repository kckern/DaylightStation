import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveBookCover } from './ResolveBookCover.mjs';

const BOOK = {
  isbn13: '9780064400558', isbn10: '0064400557',
  googleVolumeId: 'H_v1zAEACAAJ', title: "Charlotte's Web", authors: ['E. B. White'], coverUrl: null,
};

const ART = Buffer.alloc(50000, 0x41);

/** A store that behaves like BookCoverStore without touching a disk. */
function fakeStore() {
  const art = new Map(); const meta = new Map();
  return {
    art, meta,
    read: (isbn) => (art.has(isbn) ? { bytes: art.get(isbn), contentType: 'image/jpeg', source: meta.get(isbn)?.source ?? null } : null),
    readMeta: (isbn) => meta.get(isbn) ?? null,
    has: (isbn) => art.has(isbn),
    save: (isbn, detail) => { art.set(isbn, detail.bytes); meta.set(isbn, { ...detail, file: `${isbn}.jpg` }); },
    saveMiss: (isbn, detail) => { meta.set(isbn, { ...detail, file: null }); },
  };
}

/** A cover fetcher whose answers are scripted per URL substring. */
function fakeArt(script, { canSearch = false, results = [] } = {}) {
  const asked = [];
  return {
    asked, canSearch,
    async fetch(url) {
      asked.push(url);
      const hit = Object.keys(script).find((key) => url.includes(key));
      return hit
        ? { usable: true, reason: null, bytes: ART, contentType: 'image/jpeg', width: 342, height: 500, format: 'jpeg', byteLength: ART.length, ...script[hit] }
        : { usable: false, reason: 'http-404', bytes: null, contentType: null, width: null, height: null, format: null, byteLength: 0 };
    },
    async searchImages() { return results; },
  };
}

describe('ResolveBookCover', () => {
  let store;
  beforeEach(() => { store = fakeStore(); });

  const build = (coverArt, extra = {}) => new ResolveBookCover({
    coverArt, store, repository: { async findByIsbn() { return BOOK; } },
    logger: { info() {}, warn() {}, debug() {} }, ...extra,
  });

  it('stops at the first rung that answers with a real cover', async () => {
    const coverArt = fakeArt({ 'covers.openlibrary.org': {} });
    const result = await build(coverArt).execute(BOOK.isbn13);
    expect(result).toMatchObject({ status: 'found', source: 'openlibrary-isbn', attempts: 1 });
    expect(coverArt.asked).toHaveLength(1);
    expect(store.has(BOOK.isbn13)).toBe(true);
  });

  it('falls through a rung that answers 200 with a sentinel', async () => {
    // Exactly the measured shape: OpenLibrary 404s, Amazon has it.
    const coverArt = fakeArt({ 'images-na.ssl-images-amazon.com': {} });
    const result = await build(coverArt).execute(BOOK.isbn13);
    expect(result).toMatchObject({ status: 'found', source: 'amazon' });
    expect(result.tried).toEqual(['openlibrary-isbn:http-404']);
  });

  it('reaches the image search only after every catalogue has missed', async () => {
    const coverArt = fakeArt({ 'cdn.example': {} }, { canSearch: true, results: ['https://cdn.example/c.jpg'] });
    const result = await build(coverArt).execute(BOOK.isbn13);
    expect(result).toMatchObject({ status: 'found', source: 'image-search' });
    expect(coverArt.asked.at(-1)).toBe('https://cdn.example/c.jpg');
    expect(coverArt.asked.length).toBeGreaterThan(1);
  });

  it('skips the search rung entirely when no key is configured', async () => {
    const coverArt = fakeArt({}, { canSearch: false, results: ['https://cdn.example/c.jpg'] });
    const result = await build(coverArt).execute(BOOK.isbn13);
    expect(result.status).toBe('none');
    expect(coverArt.asked).not.toContain('https://cdn.example/c.jpg');
  });

  it('records a miss so the next render does not re-walk six providers', async () => {
    const coverArt = fakeArt({});
    const resolver = build(coverArt);
    await resolver.execute(BOOK.isbn13);
    const walked = coverArt.asked.length;
    expect(walked).toBeGreaterThan(0);

    expect(await resolver.execute(BOOK.isbn13)).toMatchObject({ status: 'settled' });
    expect(coverArt.asked).toHaveLength(walked);
  });

  it('asks again once the retry date has passed — catalogues gain covers', async () => {
    let now = new Date('2026-09-09T00:00:00Z');
    const coverArt = fakeArt({});
    const resolver = build(coverArt, { clock: () => now, retryMs: 1000 });
    await resolver.execute(BOOK.isbn13);
    const walked = coverArt.asked.length;

    now = new Date('2026-09-09T00:00:02Z');
    await resolver.execute(BOOK.isbn13);
    expect(coverArt.asked.length).toBe(walked * 2);
  });

  it('walks once for a shelf that renders the same book four times at once', async () => {
    const coverArt = fakeArt({ 'covers.openlibrary.org': {} });
    const resolver = build(coverArt);
    await Promise.all([1, 2, 3, 4].map(() => resolver.execute(BOOK.isbn13)));
    expect(coverArt.asked).toHaveLength(1);
  });

  it('never throws at a caller that was only rendering a tile', async () => {
    const coverArt = { canSearch: false, async fetch() { throw new Error('network on fire'); }, async searchImages() { return []; } };
    await expect(build(coverArt).execute(BOOK.isbn13)).resolves.toMatchObject({ status: 'none' });
  });

  it('serves stored art without asking anyone', async () => {
    const coverArt = fakeArt({ 'covers.openlibrary.org': {} });
    const resolver = build(coverArt);
    await resolver.cover(BOOK.isbn13);
    coverArt.asked.length = 0;
    expect((await resolver.cover(BOOK.isbn13))?.bytes).toBe(ART);
    expect(coverArt.asked).toHaveLength(0);
  });

  it('refuses to walk for something that is not an ISBN-13', async () => {
    const coverArt = fakeArt({ 'covers.openlibrary.org': {} });
    expect(await build(coverArt).execute('not-a-number')).toMatchObject({ status: 'none' });
    expect(coverArt.asked).toHaveLength(0);
  });
});
