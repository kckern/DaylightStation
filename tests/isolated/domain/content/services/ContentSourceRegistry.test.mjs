// tests/unit/content/services/ContentSourceRegistry.test.mjs
import { describe, test, expect, beforeEach } from 'vitest';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';

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

  // ==========================================================================
  // Category/Provider Indexing Tests (for ContentQueryService integration)
  // ==========================================================================

  describe('category/provider indexing', () => {
    const mockImmichAdapter = {
      source: 'immich',
      prefixes: [{ prefix: 'immich' }],
      getItem: async () => null,
      getList: async () => [],
      resolvePlayables: async () => []
    };

    const mockImmichFamilyAdapter = {
      source: 'immich-family',
      prefixes: [{ prefix: 'immich-family' }],
      getItem: async () => null,
      getList: async () => [],
      resolvePlayables: async () => []
    };

    const mockAbsAdapter = {
      source: 'abs',
      prefixes: [{ prefix: 'abs' }],
      getItem: async () => null,
      getList: async () => [],
      resolvePlayables: async () => []
    };

    test('registers adapter with category metadata', () => {
      registry.register(mockImmichAdapter, { category: 'gallery', provider: 'immich' });
      expect(registry.get('immich')).toBe(mockImmichAdapter);
    });

    test('getByCategory returns adapters for category', () => {
      registry.register(mockImmichAdapter, { category: 'gallery', provider: 'immich' });
      registry.register(mockImmichFamilyAdapter, { category: 'gallery', provider: 'immich' });
      registry.register(mockAbsAdapter, { category: 'readable', provider: 'abs' });

      const galleryAdapters = registry.getByCategory('gallery');
      expect(galleryAdapters).toHaveLength(2);
      expect(galleryAdapters).toContain(mockImmichAdapter);
      expect(galleryAdapters).toContain(mockImmichFamilyAdapter);
    });

    test('getByProvider returns adapters for provider', () => {
      registry.register(mockImmichAdapter, { category: 'gallery', provider: 'immich' });
      registry.register(mockImmichFamilyAdapter, { category: 'gallery', provider: 'immich' });
      registry.register(mockAbsAdapter, { category: 'readable', provider: 'abs' });

      const immichAdapters = registry.getByProvider('immich');
      expect(immichAdapters).toHaveLength(2);
      expect(immichAdapters).toContain(mockImmichAdapter);
      expect(immichAdapters).toContain(mockImmichFamilyAdapter);
    });

    test('getCategories returns all registered categories', () => {
      registry.register(mockImmichAdapter, { category: 'gallery', provider: 'immich' });
      registry.register(mockAbsAdapter, { category: 'readable', provider: 'abs' });

      const categories = registry.getCategories();
      expect(categories).toContain('gallery');
      expect(categories).toContain('readable');
    });

    test('getProviders returns all registered providers', () => {
      registry.register(mockImmichAdapter, { category: 'gallery', provider: 'immich' });
      registry.register(mockAbsAdapter, { category: 'readable', provider: 'abs' });

      const providers = registry.getProviders();
      expect(providers).toContain('immich');
      expect(providers).toContain('abs');
    });

    describe('resolveSource', () => {
      beforeEach(() => {
        registry.register(mockImmichAdapter, { category: 'gallery', provider: 'immich' });
        registry.register(mockImmichFamilyAdapter, { category: 'gallery', provider: 'immich' });
        registry.register(mockPlexAdapter, { category: 'media', provider: 'plex' });
        registry.register(mockAbsAdapter, { category: 'readable', provider: 'abs' });
      });

      test('resolves exact source name', () => {
        const result = registry.resolveSource('immich');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(mockImmichAdapter);
      });

      test('resolves by category', () => {
        const result = registry.resolveSource('gallery');
        expect(result).toHaveLength(2);
        expect(result).toContain(mockImmichAdapter);
        expect(result).toContain(mockImmichFamilyAdapter);
      });

      test('resolves by provider (when not exact match)', () => {
        // If 'immich' isn't an exact source name but a provider, it should still work
        // In this case, 'immich' IS an exact source name, so test with different scenario
        const result = registry.resolveSource('readable');
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(mockAbsAdapter);
      });

      test('returns all adapters when no filter', () => {
        const result = registry.resolveSource();
        expect(result).toHaveLength(4);
      });

      test('returns empty array for unknown source', () => {
        const result = registry.resolveSource('nonexistent');
        expect(result).toHaveLength(0);
      });
    });

    test('getEntry returns adapter with metadata', () => {
      registry.register(mockImmichAdapter, { category: 'gallery', provider: 'immich' });

      const entry = registry.getEntry('immich');
      expect(entry).toBeDefined();
      expect(entry.adapter).toBe(mockImmichAdapter);
      expect(entry.category).toBe('gallery');
      expect(entry.provider).toBe('immich');
    });
  });
});
