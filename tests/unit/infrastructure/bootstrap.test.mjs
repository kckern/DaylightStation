// tests/unit/infrastructure/bootstrap.test.mjs
import { createContentRegistry } from '../../../backend/src/0_infrastructure/bootstrap.mjs';

describe('bootstrap', () => {
  describe('createContentRegistry', () => {
    it('registers FilesystemAdapter', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      });

      const adapter = registry.get('filesystem');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('filesystem');
    });

    it('registers PlexAdapter', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      });

      const adapter = registry.get('plex');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('plex');
    });

    it('registers LocalContentAdapter when dataPath provided', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        },
        dataPath: '/data'
      });

      const adapter = registry.get('local-content');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('local-content');
    });

    it('registers FolderAdapter when watchlistPath provided', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        },
        dataPath: '/data',
        watchlistPath: '/data/state/watchlist'
      });

      const adapter = registry.get('folder');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('folder');
    });

    it('does not register LocalContentAdapter without mediaBasePath', () => {
      const registry = createContentRegistry({
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        },
        dataPath: '/data'
      });

      const adapter = registry.get('local-content');
      expect(adapter).toBeUndefined();
    });

    it('does not register LocalContentAdapter without dataPath', () => {
      const registry = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      });

      const adapter = registry.get('local-content');
      expect(adapter).toBeUndefined();
    });
  });
});
