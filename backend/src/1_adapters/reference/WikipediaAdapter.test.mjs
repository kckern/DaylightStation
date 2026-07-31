// backend/src/1_adapters/reference/WikipediaAdapter.test.mjs
import { describe, it, expect } from 'vitest';
import { WikipediaAdapter } from './WikipediaAdapter.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function makeHttpClient(responses) {
  return {
    calls: [],
    async requestRaw(method, url, options = {}) {
      this.calls.push({ method, url, options });
      const match = responses.find(r => url.startsWith(r.urlPrefix));
      if (!match) throw new Error(`unexpected url: ${url}`);
      if (match.error) throw match.error;
      return { status: match.status ?? 200, ok: (match.status ?? 200) < 400, headers: {}, data: match.data };
    },
  };
}

describe('WikipediaAdapter', () => {
  it('requires a baseUrl', () => {
    expect(() => new WikipediaAdapter({ logger: silentLogger })).toThrow(/baseUrl/);
  });

  it('search hits /search with query and limit, returns result list', async () => {
    const results = [{ title: 'Isaac Newton', snippet: 'physicist', path: 'Isaac_Newton' }];
    const httpClient = makeHttpClient([{ urlPrefix: 'http://wiki:8098/search', data: results }]);
    const adapter = new WikipediaAdapter({ baseUrl: 'http://wiki:8098', httpClient, logger: silentLogger });

    const out = await adapter.search('Isaac Newton', { limit: 5 });

    expect(out).toEqual(results);
    const { url } = httpClient.calls[0];
    expect(url).toContain('q=Isaac+Newton');
    expect(url).toContain('limit=5');
  });

  it('getArticle returns { title, text } for a found article', async () => {
    const httpClient = makeHttpClient([
      { urlPrefix: 'http://wiki:8098/article/', data: { title: 'Isaac Newton', text: 'Sir Isaac Newton...' } },
    ]);
    const adapter = new WikipediaAdapter({ baseUrl: 'http://wiki:8098', httpClient, logger: silentLogger });

    const out = await adapter.getArticle('Isaac Newton');

    expect(out).toEqual({ title: 'Isaac Newton', text: 'Sir Isaac Newton...' });
    expect(httpClient.calls[0].url).toBe('http://wiki:8098/article/Isaac%20Newton');
  });

  it('getArticle returns null when the service answers 404', async () => {
    const httpClient = makeHttpClient([
      { urlPrefix: 'http://wiki:8098/article/', status: 404, data: { detail: 'not found' } },
    ]);
    const adapter = new WikipediaAdapter({ baseUrl: 'http://wiki:8098', httpClient, logger: silentLogger });

    expect(await adapter.getArticle('Zzzz Nonexistent')).toBeNull();
  });

  it('random returns { title, text }', async () => {
    const httpClient = makeHttpClient([
      { urlPrefix: 'http://wiki:8098/random', data: { title: 'Kelp', text: 'Kelp is...' } },
    ]);
    const adapter = new WikipediaAdapter({ baseUrl: 'http://wiki:8098', httpClient, logger: silentLogger });

    expect(await adapter.random()).toEqual({ title: 'Kelp', text: 'Kelp is...' });
  });

  it('health returns service status payload', async () => {
    const httpClient = makeHttpClient([
      { urlPrefix: 'http://wiki:8098/health', data: { status: 'ok', book_id: 'current' } },
    ]);
    const adapter = new WikipediaAdapter({ baseUrl: 'http://wiki:8098', httpClient, logger: silentLogger });

    expect(await adapter.health()).toEqual({ status: 'ok', book_id: 'current' });
  });

  it('wraps connection failures with the service url', async () => {
    const httpClient = makeHttpClient([
      { urlPrefix: 'http://wiki:8098/', error: new Error('fetch failed') },
    ]);
    const adapter = new WikipediaAdapter({ baseUrl: 'http://wiki:8098', httpClient, logger: silentLogger });

    await expect(adapter.search('x')).rejects.toThrow(/unreachable.*http:\/\/wiki:8098/);
  });

  it('throws on unexpected non-2xx statuses', async () => {
    const httpClient = makeHttpClient([
      { urlPrefix: 'http://wiki:8098/search', status: 503, data: { detail: 'kiwix down' } },
    ]);
    const adapter = new WikipediaAdapter({ baseUrl: 'http://wiki:8098', httpClient, logger: silentLogger });

    await expect(adapter.search('x')).rejects.toThrow(/503/);
  });
});
