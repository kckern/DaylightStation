// tests/unit/adapters/content/PlexAdapter.test.mjs
import { jest } from '@jest/globals';
import { PlexAdapter } from '../../../../backend/src/2_adapters/content/media/plex/PlexAdapter.mjs';
import { PlexClient } from '../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs';

describe('PlexAdapter', () => {
  describe('constructor', () => {
    test('has correct source and prefixes', () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });
      expect(adapter.source).toBe('plex');
      expect(adapter.prefixes).toContainEqual({ prefix: 'plex' });
    });

    test('throws error when host is missing', () => {
      expect(() => new PlexAdapter({})).toThrow('PlexAdapter requires host');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400/',
        token: 'test-token'
      });
      expect(adapter.host).toBe('http://localhost:32400');
    });
  });

  describe('getStoragePath', () => {
    test('returns plex as storage path', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });
      const storagePath = await adapter.getStoragePath('12345');
      expect(storagePath).toBe('plex');
    });
  });

  describe('getMetadata', () => {
    it('should return raw Plex metadata for rating key', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      // Mock the client
      adapter.client = {
        getMetadata: jest.fn().mockResolvedValue({
          ratingKey: '12345',
          title: 'Test Movie',
          type: 'movie',
          year: 2024,
          duration: 7200000,
          summary: 'A test movie',
          thumb: '/library/metadata/12345/thumb',
          Media: [{ Part: [{ file: '/path/to/movie.mp4' }] }]
        })
      };

      const result = await adapter.getMetadata('12345');

      expect(result.ratingKey).toBe('12345');
      expect(result.title).toBe('Test Movie');
      expect(result.type).toBe('movie');
      expect(result.year).toBe(2024);
      expect(result.duration).toBe(7200000);
      expect(result.Media).toBeDefined();
    });

    it('should return null for non-existent item', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      adapter.client = {
        getMetadata: jest.fn().mockResolvedValue(null)
      };

      const result = await adapter.getMetadata('99999');
      expect(result).toBeNull();
    });

    it('should handle client errors gracefully', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      adapter.client = {
        getMetadata: jest.fn().mockRejectedValue(new Error('Network error'))
      };

      const result = await adapter.getMetadata('12345');
      expect(result).toBeNull();
    });
  });

  describe('getContainerWithChildren', () => {
    it('should return container info bundled with children', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      // Mock getContainerInfo and getList
      adapter.getContainerInfo = jest.fn().mockResolvedValue({
        title: 'Season 1',
        image: '/thumb/123',
        type: 'season',
        childCount: 10
      });

      adapter.getList = jest.fn().mockResolvedValue([
        { id: 'plex:1', title: 'Episode 1' },
        { id: 'plex:2', title: 'Episode 2' }
      ]);

      const result = await adapter.getContainerWithChildren('plex:123');

      expect(result.container.title).toBe('Season 1');
      expect(result.container.childCount).toBe(10);
      expect(result.children.length).toBe(2);
      expect(result.children[0].title).toBe('Episode 1');
    });

    it('should return null if container not found', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      adapter.getContainerInfo = jest.fn().mockResolvedValue(null);
      adapter.getList = jest.fn().mockResolvedValue([]);

      const result = await adapter.getContainerWithChildren('plex:99999');
      expect(result).toBeNull();
    });

    it('should return empty children array if no children', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });

      adapter.getContainerInfo = jest.fn().mockResolvedValue({
        title: 'Empty Season',
        type: 'season'
      });
      adapter.getList = jest.fn().mockResolvedValue(null);

      const result = await adapter.getContainerWithChildren('plex:123');
      expect(result.container.title).toBe('Empty Season');
      expect(result.children).toEqual([]);
    });
  });
});

describe('PlexClient', () => {
  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new PlexClient({})).toThrow('PlexClient requires host');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const client = new PlexClient({
        host: 'http://localhost:32400/',
        token: 'test-token'
      });
      expect(client.host).toBe('http://localhost:32400');
    });

    test('accepts empty token', () => {
      const client = new PlexClient({
        host: 'http://localhost:32400'
      });
      expect(client.token).toBe('');
    });
  });
});
