// tests/unit/content/services/ContentSourceRegistry.test.mjs
import { ContentSourceRegistry } from '@backend/src/1_domains/content/services/ContentSourceRegistry.mjs';

describe('ContentSourceRegistry', () => {
  let registry;

  const mockPlexAdapter = {
    source: 'plex',
    prefixes: [{ prefix: 'plex' }],
    getItem: async () => null,
    getList: async () => [],
    resolvePlayables: async () => []
  };

  const mockFilesystemAdapter = {
    source: 'filesystem',
    prefixes: [
      { prefix: 'media' },
      { prefix: 'file' }
    ],
    getItem: async () => null,
    getList: async () => [],
    resolvePlayables: async () => []
  };

  beforeEach(() => {
    registry = new ContentSourceRegistry();
  });

  test('registers adapter by source name', () => {
    registry.register(mockPlexAdapter);
    expect(registry.get('plex')).toBe(mockPlexAdapter);
  });

  test('resolves adapter from prefix', () => {
    registry.register(mockFilesystemAdapter);

    const result = registry.resolveFromPrefix('media', 'audio/song.mp3');
    expect(result.adapter).toBe(mockFilesystemAdapter);
    expect(result.localId).toBe('audio/song.mp3');
  });

  test('resolve handles compound ID', () => {
    registry.register(mockPlexAdapter);

    const result = registry.resolve('plex:12345');
    expect(result.adapter).toBe(mockPlexAdapter);
    expect(result.localId).toBe('12345');
  });

  test('returns null for unknown source', () => {
    expect(registry.resolve('unknown:123')).toBeNull();
  });

  test('lists registered prefixes', () => {
    registry.register(mockPlexAdapter);
    registry.register(mockFilesystemAdapter);

    const prefixes = registry.getRegisteredPrefixes();
    expect(prefixes).toContain('plex');
    expect(prefixes).toContain('media');
    expect(prefixes).toContain('file');
  });

  test('applies idTransform when resolving from prefix', () => {
    const adapterWithTransform = {
      source: 'hymn',
      prefixes: [{ prefix: 'hymn', idTransform: (id) => `songs/${id}` }],
      getItem: async () => null,
      getList: async () => [],
      resolvePlayables: async () => []
    };

    registry.register(adapterWithTransform);
    const result = registry.resolveFromPrefix('hymn', 'abc123');
    expect(result.localId).toBe('songs/abc123');
  });

  test('canResolve returns true for resolvable IDs', () => {
    registry.register(mockPlexAdapter);
    expect(registry.canResolve('plex:12345')).toBe(true);
  });

  test('canResolve returns false for unknown sources', () => {
    expect(registry.canResolve('unknown:123')).toBe(false);
  });

  test('resolve falls back to filesystem for ID without colon', () => {
    registry.register(mockFilesystemAdapter);
    const result = registry.resolve('audio/song.mp3');
    expect(result.adapter).toBe(mockFilesystemAdapter);
    expect(result.localId).toBe('audio/song.mp3');
  });
});
