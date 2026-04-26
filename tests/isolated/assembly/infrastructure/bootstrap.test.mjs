// tests/unit/infrastructure/bootstrap.test.mjs
import { createContentRegistry } from '#backend/src/0_system/bootstrap.mjs';

describe('bootstrap', () => {
  describe('createContentRegistry', () => {
    it('registers FileAdapter', () => {
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      });

      const adapter = registry.get('files');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('files');
    });

    it('registers PlexAdapter', () => {
      // Production now requires httpClient injection to register Plex; the
      // adapter constructor needs the HTTP transport. Inject a stub.
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      }, {
        httpClient: { get: () => Promise.resolve({ data: {} }) }
      });

      const adapter = registry.get('plex');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('plex');
    });

    it('registers LocalContentAdapter when dataPath provided', () => {
      const { registry } = createContentRegistry({
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

    it('registers ListAdapter under "watchlist" alias when listDataPath/dataPath provided', () => {
      // Production no longer ships a stand-alone FolderAdapter for the
      // 'watchlist' source; ListAdapter (source 'list') is registered as
      // the alias 'watchlist' via the legacy registry.adapters map only —
      // not the structured #adapterEntries (see ListAdapter wiring in
      // backend/src/0_system/bootstrap.mjs:507).
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        },
        dataPath: '/data',
        watchlistPath: '/data/state/watchlist'
      }, {
        httpClient: { get: () => Promise.resolve({ data: {} }) }
      });

      const adapter = registry.adapters.get('watchlist');
      expect(adapter).toBeDefined();
      expect(adapter.source).toBe('list');
    });

    it('does not register LocalContentAdapter without mediaBasePath', () => {
      const { registry } = createContentRegistry({
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
      const { registry } = createContentRegistry({
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
