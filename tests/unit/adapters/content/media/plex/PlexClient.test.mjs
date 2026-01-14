// tests/unit/adapters/content/media/plex/PlexClient.test.mjs
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

describe('PlexClient', () => {
  let mockFetch;
  let originalFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    originalFetch = global.fetch;
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create client with host and token', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      expect(client.host).toBe('http://localhost:32400');
      expect(client.token).toBe('test-token');
    });

    it('should throw if host not provided', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      expect(() => new PlexClient({})).toThrow('PlexClient requires host');
    });

    it('should strip trailing slash from host', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      const client = new PlexClient({
        host: 'http://localhost:32400/',
        token: 'test-token'
      });

      expect(client.host).toBe('http://localhost:32400');
    });
  });

  describe('request', () => {
    it('should make authenticated request with token header', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: {} })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      await client.request('/library/sections');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:32400/library/sections',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Plex-Token': 'test-token'
          })
        })
      );
    });

    it('should throw on non-ok response', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'bad-token'
      });

      await expect(client.request('/library/sections')).rejects.toThrow('Plex API error: 401 Unauthorized');
    });
  });

  describe('hubSearch', () => {
    it('should search Plex hub and return results', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

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
      });

      const results = await client.hubSearch('Test Movie');

      expect(results.results).toHaveLength(1);
      expect(results.results[0].ratingKey).toBe('123');
      expect(results.results[0].title).toBe('Test Movie');
    });

    it('should flatten results from multiple hubs', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

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
      });

      const results = await client.hubSearch('Test');

      expect(results.results).toHaveLength(2);
    });

    it('should return empty results when no matches', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          MediaContainer: { Hub: [] }
        })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      const results = await client.hubSearch('Nonexistent');

      expect(results.results).toHaveLength(0);
    });

    it('should encode query parameter', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: { Hub: [] } })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      await client.hubSearch('Test Movie & Show');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=Test%20Movie%20%26%20Show'),
        expect.any(Object)
      );
    });

    it('should filter by library if provided', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: { Hub: [] } })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      await client.hubSearch('Test', { libraryId: '5' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sectionId=5'),
        expect.any(Object)
      );
    });

    it('should respect limit option', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: { Hub: [] } })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      await client.hubSearch('Test', { limit: 25 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=25'),
        expect.any(Object)
      );
    });

    it('should handle missing Hub array gracefully', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ MediaContainer: {} })
      });

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      const results = await client.hubSearch('Test');

      expect(results.results).toHaveLength(0);
    });

    it('should handle missing Metadata in hub gracefully', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

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
      });

      const results = await client.hubSearch('Test');

      expect(results.results).toHaveLength(0);
    });
  });

  describe('buildUrl', () => {
    it('should build full URL with token', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      const url = client.buildUrl('/photo/:/transcode');

      expect(url).toBe('http://localhost:32400/photo/:/transcode?X-Plex-Token=test-token');
    });

    it('should append token to existing query params', async () => {
      const { PlexClient } = await import(
        '../../../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
      );

      const client = new PlexClient({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      const url = client.buildUrl('/photo/:/transcode?width=100');

      expect(url).toBe('http://localhost:32400/photo/:/transcode?width=100&X-Plex-Token=test-token');
    });
  });
});
