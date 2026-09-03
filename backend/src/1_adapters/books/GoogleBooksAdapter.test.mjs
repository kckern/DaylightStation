import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '#system/services/HttpClient.mjs';
import { GoogleBooksAdapter } from './GoogleBooksAdapter.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeHttpClient(responses) {
  return {
    calls: [],
    async requestRaw(method, url, options = {}) {
      this.calls.push({ method, url, options });
      const match = responses.find((r) => url.includes(r.match ?? '/volumes'));
      if (!match) throw new Error(`unexpected url: ${url}`);
      if (match.error) throw match.error;
      const status = match.status ?? 200;
      return { status, ok: status < 400, headers: {}, data: match.data };
    },
  };
}

const adapterWith = (responses, opts = {}) => new GoogleBooksAdapter({
  httpClient: makeHttpClient(responses), logger: silentLogger, ...opts,
});

const volumes = (volumeInfo, id = 'abc123') => ({ totalItems: 1, items: [{ id, volumeInfo }] });

describe('GoogleBooksAdapter', () => {
  it('identifies itself', () => {
    expect(adapterWith([]).id).toBe('googlebooks');
  });

  it('returns a complete native record, with no Google shapes left', async () => {
    const adapter = adapterWith([{ data: volumes({
      title: 'Guys from Space',
      authors: ['Daniel Pinkwater'],
      publisher: 'Macmillan',
      publishedDate: '1989',
      pageCount: 32,
      categories: ['Juvenile Fiction'],
      description: 'A boy accompanies some spacemen…',
      imageLinks: { thumbnail: 'http://books.google.com/books?id=abc&zoom=1' },
    }, 'vol-1') }]);

    const record = await adapter.byIsbn('9780027746723');

    expect(record.sources).toEqual(['googlebooks']);
    expect(record.title).toBe('Guys from Space');
    expect(record.authors).toEqual(['Daniel Pinkwater']);
    expect(record.publishedYear).toBe(1989);
    expect(record.pageCount).toBe(32);
    expect(record.categories).toEqual(['Juvenile Fiction']);
    expect(record.description).toBe('A boy accompanies some spacemen…');
    expect(record.googleVolumeId).toBe('vol-1');
    expect(record.isbn13).toBe('9780027746723');
  });

  it('drops a zero pageCount rather than letting it beat a real one', async () => {
    // Measured 2026-09-02: Google returned 0 for Narnia and Guys from Space.
    const adapter = adapterWith([{ data: volumes({ title: 'x', pageCount: 0 }) }]);
    expect((await adapter.byIsbn('9780064471046')).pageCount).toBeNull();
  });

  it('upgrades the cover to https, because the page is served over https', async () => {
    const adapter = adapterWith([{ data: volumes({
      title: 'x', imageLinks: { thumbnail: 'http://books.google.com/books?id=a' },
    }) }]);
    expect((await adapter.byIsbn('9780064471046')).coverUrl).toMatch(/^https:/);
  });

  it('takes a year out of a full publishedDate', async () => {
    const adapter = adapterWith([{ data: volumes({ title: 'x', publishedDate: '2005-08-01' }) }]);
    expect((await adapter.byIsbn('9780064400558')).publishedYear).toBe(2005);
  });

  it('prefers an exact ISBN match over the first item Google ranks', async () => {
    // Google's items[0] lands on packaging variants — "Charlotte's Web Book and
    // Charm", "…Wardrobe (rack)". When an item declares our ISBN, take that one.
    const data = {
      totalItems: 2,
      items: [
        { id: 'bundle', volumeInfo: { title: "Charlotte's Web Book and Charm",
          industryIdentifiers: [{ type: 'ISBN_13', identifier: '9999999999999' }] } },
        { id: 'real', volumeInfo: { title: "Charlotte's Web",
          industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780064400558' }] } },
      ],
    };
    const record = await adapterWith([{ data }]).byIsbn('9780064400558');
    expect(record.title).toBe("Charlotte's Web");
    expect(record.googleVolumeId).toBe('real');
  });

  it('returns null when Google has nothing', async () => {
    expect(await adapterWith([{ data: { totalItems: 0, items: [] } }]).byIsbn('9780064400558')).toBeNull();
  });

  it('sends the api key when one is configured', async () => {
    const httpClient = makeHttpClient([{ data: volumes({ title: 'x' }) }]);
    const adapter = new GoogleBooksAdapter({ httpClient, logger: silentLogger, apiKey: 'SECRET' });
    await adapter.byIsbn('9780064400558');
    expect(httpClient.calls[0].url).toContain('key=SECRET');
  });

  it('works without an api key, since keyless lookups still sometimes succeed', async () => {
    const httpClient = makeHttpClient([{ data: volumes({ title: 'x' }) }]);
    await new GoogleBooksAdapter({ httpClient, logger: silentLogger }).byIsbn('9780064400558');
    expect(httpClient.calls[0].url).not.toContain('key=');
  });

  it('throws on a 429 so a spent quota is never recorded as a missing book', async () => {
    const adapter = adapterWith([{ status: 429, data: { error: { message: 'Quota exceeded' } } }]);
    await expect(adapter.byIsbn('9780064400558')).rejects.toThrow(/429/);
  });

  it('refuses a non-canonical ISBN rather than calling out', async () => {
    await expect(adapterWith([]).byIsbn('123')).rejects.toThrow(/isbn/i);
  });

  describe('timeouts (review M3)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('bounds the request at 8s by default, or at the injected timeoutMs', async () => {
      const byDefault = makeHttpClient([{ data: volumes({ title: 'X' }) }]);
      await new GoogleBooksAdapter({ httpClient: byDefault, logger: silentLogger }).byIsbn('9780064400558');
      expect(byDefault.calls[0].options.timeout).toBe(8000);

      const injected = makeHttpClient([{ data: volumes({ title: 'X' }) }]);
      await new GoogleBooksAdapter({ httpClient: injected, logger: silentLogger, timeoutMs: 1500 }).byIsbn('9780064400558');
      expect(injected.calls[0].options.timeout).toBe(1500);
    });

    it('a provider that never answers is a thrown failure within timeoutMs, not a hang', async () => {
      vi.stubGlobal('fetch', (url, { signal } = {}) => new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      }));
      const adapter = new GoogleBooksAdapter({
        httpClient: new HttpClient({ logger: silentLogger }), logger: silentLogger, timeoutMs: 20,
      });
      await expect(adapter.byIsbn('9780064400558')).rejects.toThrow(/aborted/);
    }, 2000);
  });
});
