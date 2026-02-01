// tests/unit/adapters/content/PlexAdapter.test.mjs
import { jest } from '@jest/globals';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { PlexClient } from '#adapters/content/media/plex/PlexClient.mjs';

// Helper to create mock httpClient
const createMockHttpClient = () => ({ get: jest.fn(), post: jest.fn() });

describe('PlexAdapter', () => {
  describe('constructor', () => {
    test('has correct source and prefixes', () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );
      expect(adapter.source).toBe('plex');
      expect(adapter.prefixes).toContainEqual({ prefix: 'plex' });
    });

    test('throws error when host is missing', () => {
      expect(() => new PlexAdapter({}, { httpClient: createMockHttpClient() })).toThrow('PlexAdapter requires host');
    });

    test('throws error when httpClient is missing', () => {
      expect(() => new PlexAdapter({ host: 'http://localhost:32400' })).toThrow('PlexAdapter requires httpClient');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400/', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );
      expect(adapter.host).toBe('http://localhost:32400');
    });
  });

  describe('getStoragePath', () => {
    test('returns plex as storage path', async () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );
      const storagePath = await adapter.getStoragePath('12345');
      expect(storagePath).toBe('plex');
    });
  });

  describe('getMetadata', () => {
    it('should return raw Plex metadata for rating key', async () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );

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
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );

      adapter.client = {
        getMetadata: jest.fn().mockResolvedValue(null)
      };

      const result = await adapter.getMetadata('99999');
      expect(result).toBeNull();
    });

    it('should handle client errors gracefully', async () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );

      adapter.client = {
        getMetadata: jest.fn().mockRejectedValue(new Error('Network error'))
      };

      const result = await adapter.getMetadata('12345');
      expect(result).toBeNull();
    });
  });

  describe('getContainerWithChildren', () => {
    it('should return container info bundled with children', async () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );

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
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );

      adapter.getContainerInfo = jest.fn().mockResolvedValue(null);
      adapter.getList = jest.fn().mockResolvedValue([]);

      const result = await adapter.getContainerWithChildren('plex:99999');
      expect(result).toBeNull();
    });

    it('should return empty children array if no children', async () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );

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

  describe('IMediaSearchable interface', () => {
    describe('getSearchCapabilities', () => {
      test('returns supported query fields', () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        const capabilities = adapter.getSearchCapabilities();

        expect(capabilities.canonical).toContain('text');
        expect(capabilities.canonical).toContain('mediaType');
        expect(capabilities.canonical).toContain('tags');
        expect(capabilities.specific).toContain('ratingMin');
      });
    });

    describe('search', () => {
      test('returns empty results when no text query provided', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        const result = await adapter.search({});

        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });

      test('searches via hubSearch and returns PlayableItems for movies', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        // Mock hubSearch
        adapter.client.hubSearch = jest.fn().mockResolvedValue({
          results: [
            { ratingKey: '12345', title: 'Test Movie', type: 'movie', year: 2024 }
          ]
        });

        // Mock getItem for full metadata
        adapter.getItem = jest.fn().mockResolvedValue({
          id: 'plex:12345',
          source: 'plex',
          title: 'Test Movie',
          mediaType: 'video',
          mediaUrl: '/api/v1/proxy/plex/stream/12345',
          metadata: { type: 'movie', rating: 8 }
        });

        const result = await adapter.search({ text: 'test' });

        expect(adapter.client.hubSearch).toHaveBeenCalledWith('test', { limit: 50 });
        expect(result.items.length).toBe(1);
        expect(result.items[0].id).toBe('plex:12345');
        expect(result.total).toBe(1);
      });

      test('filters by mediaType video', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Movie', type: 'movie' },
            { ratingKey: '2', title: 'Song', type: 'track' },
            { ratingKey: '3', title: 'Episode', type: 'episode' }
          ]
        });

        adapter.getItem = jest.fn().mockImplementation(async (id) => ({
          id: `plex:${id}`,
          source: 'plex',
          title: `Item ${id}`,
          metadata: {}
        }));

        const result = await adapter.search({ text: 'test', mediaType: 'video' });

        // Should only return movie and episode, not track
        expect(result.items.length).toBe(2);
      });

      test('filters by mediaType audio', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Movie', type: 'movie' },
            { ratingKey: '2', title: 'Song', type: 'track' }
          ]
        });

        adapter.getItem = jest.fn().mockImplementation(async (id) => ({
          id: `plex:${id}`,
          source: 'plex',
          title: `Item ${id}`,
          metadata: {}
        }));

        const result = await adapter.search({ text: 'test', mediaType: 'audio' });

        // Should only return track
        expect(result.items.length).toBe(1);
      });

      test('filters by ratingMin', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'High Rated', type: 'movie' },
            { ratingKey: '2', title: 'Low Rated', type: 'movie' }
          ]
        });

        adapter.getItem = jest.fn().mockImplementation(async (id) => {
          const ratings = { '1': 9, '2': 3 }; // Plex 0-10 scale
          return {
            id: `plex:${id}`,
            source: 'plex',
            title: `Movie ${id}`,
            metadata: { rating: ratings[id] }
          };
        });

        // ratingMin 4 = Plex rating 8+ (normalized: rating/2)
        const result = await adapter.search({ text: 'test', ratingMin: 4 });

        expect(result.items.length).toBe(1);
        expect(result.items[0].id).toBe('plex:1');
      });

      test('filters by tags/labels', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Tagged Movie', type: 'movie' },
            { ratingKey: '2', title: 'Untagged Movie', type: 'movie' }
          ]
        });

        adapter.getItem = jest.fn().mockImplementation(async (id) => {
          const labels = { '1': ['fitness', 'workout'], '2': [] };
          return {
            id: `plex:${id}`,
            source: 'plex',
            title: `Movie ${id}`,
            metadata: { labels: labels[id] }
          };
        });

        const result = await adapter.search({ text: 'test', tags: ['fitness'] });

        expect(result.items.length).toBe(1);
        expect(result.items[0].id).toBe('plex:1');
      });

      test('respects take limit', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockResolvedValue({ results: [] });

        await adapter.search({ text: 'test', take: 25 });

        expect(adapter.client.hubSearch).toHaveBeenCalledWith('test', { limit: 25 });
      });

      test('applies skip offset', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'First', type: 'movie' },
            { ratingKey: '2', title: 'Second', type: 'movie' },
            { ratingKey: '3', title: 'Third', type: 'movie' }
          ]
        });

        adapter.getItem = jest.fn().mockImplementation(async (id) => ({
          id: `plex:${id}`,
          source: 'plex',
          title: `Movie ${id}`,
          metadata: {}
        }));

        const result = await adapter.search({ text: 'test', skip: 2 });

        // Should skip first 2, return only third
        expect(result.items.length).toBe(1);
        expect(result.items[0].id).toBe('plex:3');
      });

      test('handles search errors gracefully', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockRejectedValue(new Error('Network error'));

        const result = await adapter.search({ text: 'test' });

        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });

      test('returns ListableItem for container types', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = jest.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'TV Show', type: 'show', key: '/library/metadata/1/children' }
          ]
        });

        const result = await adapter.search({ text: 'test' });

        expect(result.items.length).toBe(1);
        expect(result.items[0].itemType).toBe('container');
      });
    });
  });

  describe('getList polymorphic input', () => {
    let adapter;
    let mockClient;
    let mockHttpClient;

    beforeEach(() => {
      mockHttpClient = { get: jest.fn(), post: jest.fn() };
      adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      mockClient = {
        getContainer: jest.fn(),
        getMetadata: jest.fn()
      };
      adapter.client = mockClient;
    });

    test('accepts string ID (backward compatible)', async () => {
      mockClient.getContainer.mockResolvedValue({
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', title: 'Playlist 1', type: 'playlist' }
          ]
        }
      });

      const result = await adapter.getList('playlist:');
      expect(mockClient.getContainer).toHaveBeenCalledWith('/playlist:');
      expect(result).toHaveLength(1);
    });

    test('accepts object with from property', async () => {
      mockClient.getContainer.mockResolvedValue({
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', title: 'Playlist 1', type: 'playlist' }
          ]
        }
      });

      const result = await adapter.getList({ from: 'playlist:' });
      expect(mockClient.getContainer).toHaveBeenCalledWith('/playlist:');
      expect(result).toHaveLength(1);
    });

    test('filters playlists by plex.libraryName (exact match)', async () => {
      mockClient.getContainer.mockResolvedValue({
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', title: 'Rock Hits', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Music' },
            { ratingKey: '2', title: 'Lectures', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Audiobooks' },
            { ratingKey: '3', title: 'Movies', type: 'playlist', playlistType: 'video', librarySectionTitle: 'Films' }
          ]
        }
      });

      const result = await adapter.getList({
        from: 'playlist:',
        'plex.libraryName': 'Music'
      });

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Rock Hits');
    });

    test('filters playlists by plex.libraryName (case-insensitive)', async () => {
      mockClient.getContainer.mockResolvedValue({
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', title: 'Rock Hits', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Music' }
          ]
        }
      });

      const result = await adapter.getList({
        from: 'playlist:',
        'plex.libraryName': 'music'
      });

      expect(result).toHaveLength(1);
    });

    test('falls back to contains match if no exact match', async () => {
      mockClient.getContainer.mockResolvedValue({
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', title: 'Jazz', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'My Music Library' },
            { ratingKey: '2', title: 'Podcasts', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Spoken Word' }
          ]
        }
      });

      const result = await adapter.getList({
        from: 'playlist:',
        'plex.libraryName': 'Music'
      });

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Jazz');
    });

    test('filters to audio playlists only when libraryName specified', async () => {
      mockClient.getContainer.mockResolvedValue({
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', title: 'Rock', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Music' },
            { ratingKey: '2', title: 'Music Videos', type: 'playlist', playlistType: 'video', librarySectionTitle: 'Music' }
          ]
        }
      });

      const result = await adapter.getList({
        from: 'playlist:',
        'plex.libraryName': 'Music'
      });

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Rock');
    });
  });
});

describe('PlexClient', () => {
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = { get: jest.fn(), post: jest.fn() };
  });

  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new PlexClient({}, { httpClient: mockHttpClient })).toThrow('PlexClient requires host');
    });

    test('throws error when httpClient is missing', () => {
      expect(() => new PlexClient({ host: 'http://localhost:32400' })).toThrow('PlexClient requires httpClient');
    });

    test('creates client with valid config and dependencies', () => {
      const client = new PlexClient({
        host: 'http://localhost:32400/',
        token: 'test-token'
      }, { httpClient: mockHttpClient });
      // Client created successfully - no error thrown
      expect(client).toBeDefined();
    });
  });
});
