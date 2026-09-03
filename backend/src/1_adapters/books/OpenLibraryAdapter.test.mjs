import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '#system/services/HttpClient.mjs';
import { OpenLibraryAdapter } from './OpenLibraryAdapter.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeHttpClient(responses) {
  return {
    calls: [],
    async requestRaw(method, url, options = {}) {
      this.calls.push({ method, url, options });
      const match = responses.find((r) => url.includes(r.match));
      if (!match) throw new Error(`unexpected url: ${url}`);
      if (match.error) throw match.error;
      const status = match.status ?? 200;
      return { status, ok: status < 400, headers: {}, data: match.data };
    },
  };
}

const adapterWith = (responses) => new OpenLibraryAdapter({
  httpClient: makeHttpClient(responses), logger: silentLogger,
});

/** Shapes below are trimmed from real 2026-09-02 responses, not invented. */
const NARNIA_EDITION = {
  'ISBN:9780064471046': {
    title: 'The Lion, the Witch, and the Wardrobe',
    authors: [{ name: 'C. S. Lewis', url: 'https://openlibrary.org/authors/OL19741A/x' }],
    number_of_pages: 208,
    publishers: [{ name: 'HarperCollins' }],
    publish_date: 'September 1, 1994',
    identifiers: { openlibrary: ['OL7942337M'], isbn_10: ['0064471047'] },
    subjects: [{ name: 'Fantasy' }, { name: 'Juvenile fiction' }],
    subject_people: [{ name: 'Aslan' }, { name: 'Mr. Tumnus' }],
    subject_places: [{ name: 'Narnia' }, { name: 'Cair Paravel' }],
    excerpts: [{ text: 'Once there were four children…', comment: 'first sentence' }],
    links: [{ title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/The_Lion,_the_Witch_and_the_Wardrobe' }],
    cover: { large: 'https://covers.openlibrary.org/b/id/1/-L.jpg' },
  },
};

describe('OpenLibraryAdapter', () => {
  it('identifies itself, because provenance keys the merge policy', () => {
    expect(adapterWith([]).id).toBe('openlibrary');
  });

  it('returns a complete, native BookRecord — no OpenLibrary shapes escape', async () => {
    const adapter = adapterWith([
      { match: '/api/books', data: NARNIA_EDITION },
      { match: '/works/', data: {} },
    ]);

    const record = await adapter.byIsbn('9780064471046');

    expect(record.sources).toEqual(['openlibrary']);
    expect(record.title).toBe('The Lion, the Witch, and the Wardrobe');
    expect(record.pageCount).toBe(208);
    expect(record.publisher).toBe('HarperCollins');
    expect(record.isbn13).toBe('9780064471046');
    expect(record.isbn10).toBe('0064471047');
    // Lists of {name} objects become lists of plain strings.
    expect(record.authors).toEqual(['C. S. Lewis']);
    expect(record.subjects).toEqual(['Fantasy', 'Juvenile fiction']);
    expect(record.people).toEqual(['Aslan', 'Mr. Tumnus']);
    expect(record.places).toEqual(['Narnia', 'Cair Paravel']);
    // Excerpt objects become plain text.
    expect(record.excerpts).toEqual(['Once there were four children…']);
    expect(record.olEditionKey).toBe('OL7942337M');
    expect(record.wikipediaUrl).toContain('en.wikipedia.org');
  });

  it('reduces a prose publish_date to a year, because that is what we model', async () => {
    const adapter = adapterWith([
      { match: '/api/books', data: NARNIA_EDITION },
      { match: '/works/', data: {} },
    ]);
    expect((await adapter.byIsbn('9780064471046')).publishedYear).toBe(1994);
  });

  it('fetches the work record for the description the edition call omits', async () => {
    // Measured: /api/books carries NO description for any book tested.
    const edition = {
      'ISBN:9780027746723': {
        title: 'Guys from space',
        number_of_pages: 32,
        identifiers: { openlibrary: ['OL2211372M'] },
      },
    };
    const adapter = adapterWith([
      { match: '/api/books', data: edition },
      { match: '/isbn/', data: { works: [{ key: '/works/OL84048W' }] } },
      { match: '/works/OL84048W', data: { description: { type: '/type/text', value: 'A boy accompanies some guys from space…' } } },
    ]);

    const record = await adapter.byIsbn('9780027746723');

    expect(record.description).toBe('A boy accompanies some guys from space…');
    expect(record.olWorkKey).toBe('OL84048W');
  });

  it('accepts a bare-string work description as well as the {type,value} wrapper', async () => {
    const adapter = adapterWith([
      { match: '/api/books', data: { 'ISBN:9780064471046': { title: 'x' } } },
      { match: '/isbn/', data: { works: [{ key: '/works/OL1W' }] } },
      { match: '/works/OL1W', data: { description: 'A bare string description.' } },
    ]);
    expect((await adapter.byIsbn('9780064471046')).description).toBe('A bare string description.');
  });

  it('splits a MARC series line into a name and a volume', async () => {
    const adapter = adapterWith([
      { match: '/api/books', data: { 'ISBN:9780064471046': { title: 'x' } } },
      { match: '/isbn/', data: { series: ['The Chronicles of Narnia -- bk. 2'], works: [] } },
    ]);

    const record = await adapter.byIsbn('9780064471046');

    expect(record.series).toBe('The Chronicles of Narnia');
    expect(record.seriesVolume).toBe(2);
  });

  it('always offers a cover URL derived from the ISBN', async () => {
    const adapter = adapterWith([
      { match: '/api/books', data: { 'ISBN:9780064471046': { title: 'x' } } },
      { match: '/isbn/', data: {} },
    ]);
    expect((await adapter.byIsbn('9780064471046')).coverUrl)
      .toBe('https://covers.openlibrary.org/b/isbn/9780064471046-L.jpg');
  });

  it('returns null for a book OpenLibrary does not have — a miss is not a failure', async () => {
    const adapter = adapterWith([{ match: '/api/books', data: {} }]);
    expect(await adapter.byIsbn('9780000000002')).toBeNull();
  });

  it('still returns the edition record when the work fetch fails', async () => {
    // Enrichment is best-effort; losing a description must not lose the book.
    const adapter = adapterWith([
      { match: '/api/books', data: NARNIA_EDITION },
      { match: '/isbn/', error: new Error('boom') },
    ]);
    const record = await adapter.byIsbn('9780064471046');
    expect(record.title).toBe('The Lion, the Witch, and the Wardrobe');
    expect(record.description).toBeNull();
  });

  it('throws when the provider itself fails, so a breakage is not read as a miss', async () => {
    const adapter = adapterWith([{ match: '/api/books', error: new Error('429 rate limited') }]);
    await expect(adapter.byIsbn('9780064471046')).rejects.toThrow(/429/);
  });

  it('refuses an ISBN that is not canonical rather than calling out', async () => {
    await expect(adapterWith([]).byIsbn('nope')).rejects.toThrow(/isbn/i);
  });

  describe('timeouts (review M3)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('bounds every request at 8s by default, or at the injected timeoutMs', async () => {
      const responses = [{ match: '/api/books', data: NARNIA_EDITION }, { match: '/isbn/', data: {} }];
      const byDefault = makeHttpClient(responses);
      await new OpenLibraryAdapter({ httpClient: byDefault, logger: silentLogger }).byIsbn('9780064471046');
      expect(byDefault.calls.length).toBeGreaterThan(0);
      for (const call of byDefault.calls) expect(call.options.timeout).toBe(8000);

      const injected = makeHttpClient(responses);
      await new OpenLibraryAdapter({ httpClient: injected, logger: silentLogger, timeoutMs: 1500 }).byIsbn('9780064471046');
      for (const call of injected.calls) expect(call.options.timeout).toBe(1500);
    });

    it('a provider that never answers is a thrown failure within timeoutMs, not a hang', async () => {
      // fetch that only ever settles by abort, the way a black-holed socket does.
      vi.stubGlobal('fetch', (url, { signal } = {}) => new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      }));
      const adapter = new OpenLibraryAdapter({
        httpClient: new HttpClient({ logger: silentLogger }), logger: silentLogger, timeoutMs: 20,
      });
      await expect(adapter.byIsbn('9780064471046')).rejects.toThrow(/aborted/);
    }, 2000);
  });
});
