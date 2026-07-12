// tests/unit/adapters/content/PlexAdapter.test.mjs
import { vi } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { PlexClient } from '#adapters/content/media/plex/PlexClient.mjs';

// Helper to create mock httpClient
const createMockHttpClient = () => ({ get: vi.fn(), post: vi.fn() });

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
        getMetadata: vi.fn().mockResolvedValue({
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
        getMetadata: vi.fn().mockResolvedValue(null)
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
        getMetadata: vi.fn().mockRejectedValue(new Error('Network error'))
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
      adapter.getContainerInfo = vi.fn().mockResolvedValue({
        title: 'Season 1',
        image: '/thumb/123',
        type: 'season',
        childCount: 10
      });

      adapter.getList = vi.fn().mockResolvedValue([
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

      adapter.getContainerInfo = vi.fn().mockResolvedValue(null);
      adapter.getList = vi.fn().mockResolvedValue([]);

      const result = await adapter.getContainerWithChildren('plex:99999');
      expect(result).toBeNull();
    });

    it('should return empty children array if no children', async () => {
      const adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: createMockHttpClient() }
      );

      adapter.getContainerInfo = vi.fn().mockResolvedValue({
        title: 'Empty Season',
        type: 'season'
      });
      adapter.getList = vi.fn().mockResolvedValue(null);

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
        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '12345', title: 'Test Movie', type: 'movie', year: 2024 }
          ]
        });

        // Mock getItem for full metadata
        adapter.getItem = vi.fn().mockResolvedValue({
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

      test('filters by mediaType video (tier 1 - containers)', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Action Movie', type: 'movie' },
            { ratingKey: '2', title: 'TV Show', type: 'show' },
            { ratingKey: '3', title: 'Artist', type: 'artist' },
            { ratingKey: '4', title: 'Song', type: 'track' }
          ]
        });

        const result = await adapter.search({ text: 'test', mediaType: 'video' });

        // Tier 1: should return video containers (movie, show) not audio (artist, track)
        expect(result.items.length).toBe(2);
        const titles = result.items.map(i => i.title);
        expect(titles).toContain('Action Movie');
        expect(titles).toContain('TV Show');
      });

      test('filters by mediaType audio (tier 1 - containers)', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Movie', type: 'movie' },
            { ratingKey: '2', title: 'Jazz Album', type: 'album' },
            { ratingKey: '3', title: 'Rock Artist', type: 'artist' }
          ]
        });

        const result = await adapter.search({ text: 'test', mediaType: 'audio' });

        // Tier 1: should return audio containers (album, artist) not video (movie)
        expect(result.items.length).toBe(2);
        const titles = result.items.map(i => i.title);
        expect(titles).toContain('Jazz Album');
        expect(titles).toContain('Rock Artist');
      });

      test('filters by mediaType video (tier 2 - leaves)', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Movie', type: 'movie' },
            { ratingKey: '2', title: 'Song', type: 'track' },
            { ratingKey: '3', title: 'Episode', type: 'episode' }
          ]
        });

        adapter.getItem = vi.fn().mockImplementation(async (id) => ({
          id: `plex:${id}`,
          source: 'plex',
          title: `Item ${id}`,
          metadata: {}
        }));

        const result = await adapter.search({ text: 'test', mediaType: 'video', tier: 2 });

        // Tier 2: should return movie and episode, not track
        expect(result.items.length).toBe(2);
      });

      test('filters by mediaType audio (tier 2 - leaves)', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Movie', type: 'movie' },
            { ratingKey: '2', title: 'Song', type: 'track' }
          ]
        });

        adapter.getItem = vi.fn().mockImplementation(async (id) => ({
          id: `plex:${id}`,
          source: 'plex',
          title: `Item ${id}`,
          metadata: {}
        }));

        const result = await adapter.search({ text: 'test', mediaType: 'audio', tier: 2 });

        // Tier 2: should only return track
        expect(result.items.length).toBe(1);
      });

      test('filters by ratingMin', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'High Rated', type: 'movie' },
            { ratingKey: '2', title: 'Low Rated', type: 'movie' }
          ]
        });

        adapter.getItem = vi.fn().mockImplementation(async (id) => {
          const ratings = { '1': 9, '2': 3 }; // Plex 0-10 scale
          return {
            id: `plex:${id}`,
            source: 'plex',
            title: `Movie ${id}`,
            metadata: { rating: ratings[id] }
          };
        });

        // ratingMin 4 = Plex rating 8+ (normalized: rating/2). Tier 2 hits the
        // hydrated path that applies the rating filter — tier 1 skips item
        // hydration entirely.
        const result = await adapter.search({ text: 'test', ratingMin: 4, tier: 2 });

        expect(result.items.length).toBe(1);
        expect(result.items[0].id).toBe('plex:1');
      });

      test('filters by tags/labels', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'Tagged Movie', type: 'movie' },
            { ratingKey: '2', title: 'Untagged Movie', type: 'movie' }
          ]
        });

        adapter.getItem = vi.fn().mockImplementation(async (id) => {
          const labels = { '1': ['fitness', 'workout'], '2': [] };
          return {
            id: `plex:${id}`,
            source: 'plex',
            title: `Movie ${id}`,
            metadata: { labels: labels[id] }
          };
        });

        const result = await adapter.search({ text: 'test', tags: ['fitness'], tier: 2 });

        expect(result.items.length).toBe(1);
        expect(result.items[0].id).toBe('plex:1');
      });

      test('respects take limit', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({ results: [] });

        await adapter.search({ text: 'test', take: 25 });

        expect(adapter.client.hubSearch).toHaveBeenCalledWith('test', { limit: 25 });
      });

      test('applies skip offset', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
          results: [
            { ratingKey: '1', title: 'First', type: 'movie' },
            { ratingKey: '2', title: 'Second', type: 'movie' },
            { ratingKey: '3', title: 'Third', type: 'movie' }
          ]
        });

        adapter.getItem = vi.fn().mockImplementation(async (id) => ({
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

        adapter.client.hubSearch = vi.fn().mockRejectedValue(new Error('Network error'));

        const result = await adapter.search({ text: 'test' });

        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });

      test('returns ListableItem for container types', async () => {
        const adapter = new PlexAdapter(
          { host: 'http://localhost:32400', token: 'test-token' },
          { httpClient: createMockHttpClient() }
        );

        adapter.client.hubSearch = vi.fn().mockResolvedValue({
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
      mockHttpClient = { get: vi.fn(), post: vi.fn() };
      adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      mockClient = {
        getContainer: vi.fn(),
        getMetadata: vi.fn()
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
      expect(mockClient.getContainer).toHaveBeenCalledWith('/playlists/all');
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
      expect(mockClient.getContainer).toHaveBeenCalledWith('/playlists/all');
      expect(result).toHaveLength(1);
    });

    test('filters playlists by plex.libraryName (audio playlists for "Music")', async () => {
      // Production special-cases the "Music"/"music" libraryName to filter
      // by playlistType === 'audio' (since playlists don't carry
      // librarySectionTitle reliably). All audio playlists pass; the video
      // playlist is excluded.
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

      expect(result).toHaveLength(2);
      expect(result.map(r => r.title)).toEqual(['Rock Hits', 'Lectures']);
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

    test('falls back to librarySectionTitle contains match for non-special libraryName', async () => {
      // The "Music"/"video"/etc. names are special-cased on playlistType.
      // Other names fall through to librarySectionTitle exact-then-contains
      // matching — exercise the contains fallback with a custom library name.
      mockClient.getContainer.mockResolvedValue({
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', title: 'Jazz', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'My Lectures Library' },
            { ratingKey: '2', title: 'Podcasts', type: 'playlist', playlistType: 'audio', librarySectionTitle: 'Spoken Word' }
          ]
        }
      });

      const result = await adapter.getList({
        from: 'playlist:',
        'plex.libraryName': 'Lectures'
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

  describe('getContainerInfo', () => {
    let adapter;
    let mockClient;
    let mockHttpClient;

    beforeEach(() => {
      mockHttpClient = { get: vi.fn(), post: vi.fn() };
      adapter = new PlexAdapter(
        { host: 'http://localhost:32400', token: 'test-token' },
        { httpClient: mockHttpClient }
      );
      mockClient = {
        getContainer: vi.fn(),
        getMetadata: vi.fn()
      };
      adapter.client = mockClient;
    });

    test('uses composite thumbnail for playlists', async () => {
      mockClient.getMetadata.mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '450234',
            title: 'Stretch Playlist',
            type: 'playlist',
            playlistType: 'video',
            composite: '/playlists/450234/composite/abc123',
            leafCount: 45
          }]
        }
      });

      const info = await adapter.getContainerInfo('plex:450234');
      expect(info.image).toContain('/playlists/450234/composite/abc123');
      expect(info.type).toBe('playlist');
    });

    test('uses thumb for non-playlist containers', async () => {
      mockClient.getMetadata.mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '662027',
            title: '630',
            type: 'show',
            thumb: '/library/metadata/662027/thumb/abc',
            leafCount: 120
          }]
        }
      });

      const info = await adapter.getContainerInfo('plex:662027');
      expect(info.image).toContain('/library/metadata/662027/thumb/abc');
      expect(info.type).toBe('show');
    });
  });
});

describe('getMediaUrl error logging', () => {
  test('logs structured warning when metadata is missing', async () => {
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      getMetadata: vi.fn().mockResolvedValue({ MediaContainer: {} }),
    };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 't' },
      { httpClient: mockClient, logger }
    );
    // replace internal client so getMetadata returns empty
    adapter.client = mockClient;

    const result = await adapter.getMediaUrl('999999');

    expect(result).toEqual({ url: null, reason: 'metadata-missing' });
    expect(warn).toHaveBeenCalledWith(
      'plex.loadMediaUrl.metadataMissing',
      expect.objectContaining({ ratingKey: '999999' })
    );
  });

  test('logs structured warning on non-playable type', async () => {
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const mockClient = {
      get: vi.fn(), post: vi.fn(),
      getMetadata: vi.fn().mockResolvedValue({
        MediaContainer: { Metadata: [{ ratingKey: '1', type: 'show' }] }
      }),
    };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 't' },
      { httpClient: mockClient, logger }
    );
    adapter.client = mockClient;

    const result = await adapter.getMediaUrl('1');

    expect(result).toEqual({ url: null, reason: 'non-playable-type' });
    expect(warn).toHaveBeenCalledWith(
      'plex.loadMediaUrl.nonPlayableType',
      expect.objectContaining({ type: 'show' })
    );
  });

  test('logs structured error when exception is thrown', async () => {
    const errorLog = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: errorLog };
    const mockClient = {
      get: vi.fn(), post: vi.fn(),
      getMetadata: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 't' },
      { httpClient: mockClient, logger }
    );
    adapter.client = mockClient;

    const result = await adapter.getMediaUrl('1');

    expect(result).toEqual({ url: null, reason: 'transient' });
    expect(errorLog).toHaveBeenCalledWith(
      'plex.loadMediaUrl.exception',
      expect.objectContaining({ ratingKey: '1', error: 'boom' })
    );
  });
});

describe('PlexClient', () => {
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = { get: vi.fn(), post: vi.fn() };
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

describe('getContainerInfo - rating and parent linkage', () => {
  test('rating prefers userRating, with userRating exposed separately', async () => {
    // Convention established at PlexAdapter.mjs:509 and :623 — `rating`
    // is always the best-available value with this priority:
    //   item.userRating ?? item.rating ?? item.audienceRating ?? null
    // `userRating` is also exposed separately so consumers can distinguish
    // a user-starred rating from a fallback to the content rating.
    const mockHttpClient = { get: vi.fn(), post: vi.fn() };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 'test-token' },
      { httpClient: mockHttpClient }
    );
    const mockClient = {
      getMetadata: vi.fn().mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '603856',
            type: 'season',
            title: 'Season 2023121',
            thumb: '/library/metadata/603856/thumb/1',
            userRating: 8,
            rating: 7.5,
            parentRatingKey: '603855',
            parentTitle: 'Super Blocks'
          }]
        }
      })
    };
    adapter.client = mockClient;

    const info = await adapter.getContainerInfo('plex:603856');

    expect(info.rating).toBe(8);          // userRating wins
    expect(info.userRating).toBe(8);
  });

  test('exposes parentRatingKey for seasons', async () => {
    const mockHttpClient = { get: vi.fn(), post: vi.fn() };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 'test-token' },
      { httpClient: mockHttpClient }
    );
    const mockClient = {
      getMetadata: vi.fn().mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '603856',
            type: 'season',
            title: 'Season 2023121',
            parentRatingKey: '603855',
            parentTitle: 'Super Blocks'
          }]
        }
      })
    };
    adapter.client = mockClient;

    const info = await adapter.getContainerInfo('plex:603856');

    expect(info.parentRatingKey).toBe('603855');
    expect(info.type).toBe('season');
  });

  test('rating fields default to null when absent', async () => {
    const mockHttpClient = { get: vi.fn(), post: vi.fn() };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 'test-token' },
      { httpClient: mockHttpClient }
    );
    const mockClient = {
      getMetadata: vi.fn().mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '999',
            type: 'show',
            title: 'No Rating Show'
          }]
        }
      })
    };
    adapter.client = mockClient;

    const info = await adapter.getContainerInfo('plex:999');

    expect(info.rating).toBeNull();
    expect(info.userRating).toBeNull();
    expect(info.parentRatingKey).toBeNull();
    expect(info.parentTitle).toBeNull();
  });
});

describe('resolveSiblings - ancestor chain (breadcrumb)', () => {
  const makeAdapter = () => new PlexAdapter(
    { host: 'http://localhost:32400', token: 'test-token' },
    { httpClient: createMockHttpClient() }
  );

  // Episode metadata as produced by getItem's video path:
  // parentId = season key, grandparentId = show key (no *RatingKey fields).
  const episodeItem = {
    id: 'plex:642197',
    source: 'plex',
    title: 'Elijah the Prophet',
    metadata: {
      type: 'episode',
      parentId: '700',        // season
      grandparentId: '800',   // show
      librarySectionID: '2',
      librarySectionTitle: 'TV Shows'
    }
  };
  const seasonItem = { id: 'plex:700', source: 'plex', title: 'Season 8', metadata: { type: 'season' } };
  const showItem = { id: 'plex:800', source: 'plex', title: 'The Prophets', metadata: { type: 'show' } };

  const noGhostCrumbs = (ancestors) => {
    expect(Array.isArray(ancestors)).toBe(true);
    for (const c of ancestors) {
      expect(c.id).toBeTruthy();
      expect(c.title).toBeTruthy();
    }
  };

  test('episode WITH collection → [collection, show, season] root-first', async () => {
    const adapter = makeAdapter();
    adapter.getItem = vi.fn().mockImplementation(async (id) => {
      const key = String(id).replace(/^plex:/, '');
      if (key === '642197') return episodeItem;
      if (key === '700') return seasonItem;
      if (key === '800') return showItem;
      return null;
    });
    adapter._findSmallestCollection = vi.fn().mockResolvedValue({
      ratingKey: '900', title: 'The Old Testament', childCount: 5
    });
    adapter.getList = vi.fn().mockResolvedValue([]);

    const result = await adapter.resolveSiblings('plex:642197');

    expect(result.parent).toBeTruthy();
    noGhostCrumbs(result.ancestors);
    expect(result.ancestors).toEqual([
      { id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900', type: 'collection' },
      { id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800', type: 'show' },
      { id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700', type: 'season' }
    ]);
    // Cap enforced: show's smallest collection is looked up, not the item's.
    expect(adapter._findSmallestCollection).toHaveBeenCalledWith('800', '2');
  });

  test('episode WITHOUT collection → [library, show, season], capped at library', async () => {
    const adapter = makeAdapter();
    adapter.getItem = vi.fn().mockImplementation(async (id) => {
      const key = String(id).replace(/^plex:/, '');
      if (key === '642197') return episodeItem;
      if (key === '700') return seasonItem;
      if (key === '800') return showItem;
      return null;
    });
    adapter._findSmallestCollection = vi.fn().mockResolvedValue(null);
    adapter.getList = vi.fn().mockResolvedValue([]);

    const result = await adapter.resolveSiblings('plex:642197');

    noGhostCrumbs(result.ancestors);
    expect(result.ancestors).toEqual([
      { id: 'library:2', title: 'TV Shows', source: 'plex', localId: '2', type: 'library' },
      { id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800', type: 'show' },
      { id: 'plex:700', title: 'Season 8', source: 'plex', localId: '700', type: 'season' }
    ]);
    // Never climbs above the cap: exactly 3 crumbs, top is the library.
    expect(result.ancestors).toHaveLength(3);
    expect(result.ancestors[0].type).toBe('library');
  });

  test('season → [collection, show], capped at collection', async () => {
    const adapter = makeAdapter();
    const seasonWithParent = {
      id: 'plex:700', source: 'plex', title: 'Season 8',
      metadata: { type: 'season', parentRatingKey: '800', librarySectionID: '2', librarySectionTitle: 'TV Shows' }
    };
    adapter.getItem = vi.fn().mockImplementation(async (id) => {
      const key = String(id).replace(/^plex:/, '');
      if (key === '700') return seasonWithParent;
      if (key === '800') return showItem;
      return null;
    });
    adapter._findSmallestCollection = vi.fn().mockResolvedValue({
      ratingKey: '900', title: 'The Old Testament', childCount: 5
    });
    adapter.getList = vi.fn().mockResolvedValue([]);

    const result = await adapter.resolveSiblings('plex:700');

    noGhostCrumbs(result.ancestors);
    expect(result.ancestors).toEqual([
      { id: 'plex:900', title: 'The Old Testament', source: 'plex', localId: '900', type: 'collection' },
      { id: 'plex:800', title: 'The Prophets', source: 'plex', localId: '800', type: 'show' }
    ]);
    expect(adapter._findSmallestCollection).toHaveBeenCalledWith('800', '2');
  });

  test('drops ghost crumbs when an ancestor cannot be fetched (no null id/title)', async () => {
    const adapter = makeAdapter();
    adapter.getItem = vi.fn().mockImplementation(async (id) => {
      const key = String(id).replace(/^plex:/, '');
      if (key === '642197') return episodeItem;
      if (key === '700') return seasonItem;
      if (key === '800') return null; // show fetch fails → skip, don't emit ghost
      return null;
    });
    adapter._findSmallestCollection = vi.fn().mockResolvedValue(null);
    adapter.getList = vi.fn().mockResolvedValue([]);

    const result = await adapter.resolveSiblings('plex:642197');

    noGhostCrumbs(result.ancestors);
    // show crumb dropped; library cap + season remain
    expect(result.ancestors.map(c => c.type)).toEqual(['library', 'season']);
  });
});
