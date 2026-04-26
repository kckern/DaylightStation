// tests/unit/adapters/content/media/plex/PlexClient.test.mjs
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Translates legacy fetch() mock responses into the httpClient.get shape ({ status, data }).
// PlexClient now requires an httpClient dependency; this preserves existing test bodies that
// use mockFetch.mockResolvedValue({ ok, json }).
async function translate(fetchResponse, urlForHttpError) {
  const r = await fetchResponse;
  const status = r.status ?? (r.ok ? 200 : 500);
  const data = r.json ? await r.json() : undefined;
  if (!r.ok && r.ok !== undefined) {
    // Mimic an HTTP error so PlexClient's catch-and-wrap path still triggers
    const err = new Error(`Plex API error: ${status} ${r.statusText || ''}`.trim());
    err.code = `HTTP_${status}`;
    throw err;
  }
  return { status, data, headers: r.headers || {} };
}

function makeHttpClient(mockFetch) {
  return {
    get: (url, options) => translate(mockFetch(url, { method: 'GET', ...options }), url),
    post: (url, body, options) => translate(mockFetch(url, {
      method: 'POST', headers: options?.headers, body: typeof body === 'string' ? body : JSON.stringify(body),
    }), url),
  };
}

describe('PlexClient', () => {
  let mockFetch;
  let originalFetch;
  let httpClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    httpClient = makeHttpClient(mockFetch);
    originalFetch = global.fetch;
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create client with host and token', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      // host/token are now private fields — verify by making a request and checking the URL/headers
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ MediaContainer: {} }) });
      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });
      await client.request('/x');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:32400/x'),
        expect.objectContaining({ headers: expect.objectContaining({ 'X-Plex-Token': 'test-token' }) }),
      );
    });

    it('should throw if host not provided', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      expect(() => new PlexClient({})).toThrow('PlexClient requires host');
    });

    it('should strip trailing slash from host', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ MediaContainer: {} }) });
      const client = new PlexClient({
        host: 'http://localhost:32400/',
        token: 'test-token'
      }, { httpClient });
      await client.request('/x');

      // The trailing slash should be stripped from host before composing URLs
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/^http:\/\/localhost:32400\/x/),
        expect.any(Object),
      );
    });
  });

  describe('request', () => {
    it('should make authenticated request with token header', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: {} })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      await client.request('/library/sections');

      expect(mockFetch).toHaveBeenCalledWith(
        // Production now appends X-Plex-Token query param to support reverse proxies
        expect.stringContaining('http://localhost:32400/library/sections?X-Plex-Token=test-token'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Plex-Token': 'test-token'
          })
        })
      );
    });

    it('should throw on non-ok response', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'bad-token'
      }, { httpClient });

      // Production catches the underlying error and wraps as 'Media API request failed'
      await expect(client.request('/library/sections')).rejects.toThrow('Media API request failed');
    });
  });

  describe('hubSearch', () => {
    it('should search Plex hub and return results', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          MediaContainer: {
            Hub: [
              {
                type: 'movie',
                Metadata: [
                  { ratingKey: '123', title: 'Test Movie', year: 2020, type: 'movie', guid: 'plex://movie/abc' }
                ]
              }
            ]
          }
        })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      const results = await client.hubSearch('Test Movie');

      expect(results.results).toHaveLength(1);
      expect(results.results[0].ratingKey).toBe('123');
      expect(results.results[0].title).toBe('Test Movie');
    });

    it('should flatten results from multiple hubs', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          MediaContainer: {
            Hub: [
              { type: 'movie', Metadata: [{ ratingKey: '1', title: 'Movie 1' }] },
              { type: 'show', Metadata: [{ ratingKey: '2', title: 'Show 1' }] }
            ]
          }
        })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      const results = await client.hubSearch('Test');

      expect(results.results).toHaveLength(2);
    });

    it('should return empty results when no matches', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          MediaContainer: { Hub: [] }
        })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      const results = await client.hubSearch('Nonexistent');

      expect(results.results).toHaveLength(0);
    });

    it('should encode query parameter', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: { Hub: [] } })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      await client.hubSearch('Test Movie & Show');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=Test%20Movie%20%26%20Show'),
        expect.any(Object)
      );
    });

    it('should filter by library if provided', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: { Hub: [] } })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      await client.hubSearch('Test', { libraryId: '5' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sectionId=5'),
        expect.any(Object)
      );
    });

    it('should respect limit option', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: { Hub: [] } })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      await client.hubSearch('Test', { limit: 25 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=25'),
        expect.any(Object)
      );
    });

    it('should handle missing Hub array gracefully', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: {} })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      const results = await client.hubSearch('Test');

      expect(results.results).toHaveLength(0);
    });

    it('should handle missing Metadata in hub gracefully', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          MediaContainer: {
            Hub: [{ type: 'movie' }] // No Metadata
          }
        })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      const results = await client.hubSearch('Test');

      expect(results.results).toHaveLength(0);
    });
  });

  describe('buildUrl', () => {
    it('should build full URL with token', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      const url = client.buildUrl('/photo/:/transcode');

      expect(url).toBe('http://localhost:32400/photo/:/transcode?X-Plex-Token=test-token');
    });

    it('should append token to existing query params', async () => {
      const { PlexClient } = await import('#adapters/content/media/plex/PlexClient.mjs');

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      }, { httpClient });

      const url = client.buildUrl('/photo/:/transcode?width=100');

      expect(url).toBe('http://localhost:32400/photo/:/transcode?width=100&X-Plex-Token=test-token');
    });
  });
});
